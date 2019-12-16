import fs from 'fs';
import { Network } from 'bitcoinjs-lib';
import { BIP32Interface, fromSeed } from 'bip32';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import Errors from './Errors';
import Wallet from './Wallet';
import Logger from '../Logger';
import { CurrencyConfig } from '../Config';
import KeyRepository from './KeyRepository';
import { splitDerivationPath } from '../Utils';
import ChainClient from '../chain/ChainClient';
import LndClient from '../lightning/LndClient';
import { KeyProviderType } from '../db/models/KeyProvider';
import LndWalletProvider from './providers/LndWalletProvider';

type Currency = {
  symbol: string;
  network: Network;
  config: CurrencyConfig;
  chainClient: ChainClient;
  lndClient?: LndClient;
};

/**
 * WalletManager creates wallets instances that generate keys derived from the seed and
 * interact with the wallet of LND to send and receive onchain coins
 */
class WalletManager {
  public wallets = new Map<string, Wallet>();

  private masterNode: BIP32Interface;
  private keyRepository: KeyRepository;

  private readonly derivationPath = 'm/0';

  constructor(private logger: Logger, private currencies: Currency[], mnemonicPath: string) {
    this.masterNode = this.loadMasterNode(mnemonicPath);
    this.keyRepository = new KeyRepository();
  }

  /**
   * Initializes a new WalletManager with a mnemonic
   */
  public static fromMnemonic = (logger: Logger, mnemonic: string, mnemonicPath: string, currencies: Currency[]) => {
    if (!validateMnemonic(mnemonic)) {
      throw(Errors.INVALID_MNEMONIC(mnemonic));
    }

    fs.writeFileSync(mnemonicPath, mnemonic);

    return new WalletManager(logger, currencies, mnemonicPath);
  }

  public init = async () => {
    const keyProviderMap = await this.getKeyProviderMap();

    for (const currency of this.currencies) {
      if (currency.lndClient === undefined) {
        throw Errors.LND_NOT_FOUND(currency.symbol);
      }

      let keyProviderInfo = keyProviderMap.get(currency.symbol);

      // Generate a new KeyProvider if that currency does not have one yet
      if (!keyProviderInfo) {
        keyProviderInfo = {
          highestUsedIndex: 0,
          symbol: currency.symbol,
          derivationPath: `${this.derivationPath}/${this.getHighestDepthIndex(keyProviderMap, 2) + 1}`,
        };

        keyProviderMap.set(currency.symbol, keyProviderInfo);

        await this.keyRepository.addKeyProvider({
          ...keyProviderInfo,
          symbol: currency.symbol,
        });
      }

      const wallet = new Wallet(
        currency.network,
        keyProviderInfo.derivationPath,
        keyProviderInfo.highestUsedIndex,
        this.logger,
        this.masterNode,
        this.keyRepository,
        new LndWalletProvider(this.logger, currency.lndClient, currency.chainClient),
      );

      this.wallets.set(currency.symbol, wallet);
    }
  }

  private loadMasterNode = (filename: string) => {
    if (fs.existsSync(filename)) {
      const mnemonic = fs.readFileSync(filename, 'utf-8').toString();

      return fromSeed(mnemonicToSeedSync(mnemonic));
    }

    throw(Errors.NOT_INITIALIZED());
  }

  private getKeyProviderMap = async () => {
    const map = new Map<string, KeyProviderType>();
    const keyProviders = await this.keyRepository.getKeyProviders();

    keyProviders.forEach((keyProvider) => {
      map.set(keyProvider.symbol, {
        ...keyProvider,
      });
    });

    return map;
  }

  private getHighestDepthIndex = (map: Map<string, KeyProviderType>, depth: number): number => {
    if (depth === 0) {
      throw(Errors.INVALID_DEPTH_INDEX(depth));
    }

    let highestIndex = -1;

    map.forEach((info) => {
      const split = splitDerivationPath(info.derivationPath);
      const index = split.sub[depth - 1];

      if (index > highestIndex) {
        highestIndex = index;
      }
    });

    return highestIndex;
  }
}

export default WalletManager;
export { Currency };
