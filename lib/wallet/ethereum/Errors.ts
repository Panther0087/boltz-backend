import { providers } from 'ethers';
import { Error } from '../../consts/Types';
import { concatErrorCode } from '../../Utils';
import { ErrorCodePrefix } from '../../consts/Enums';

export default {
  NO_LOCKUP_FOUND: (): Error => ({
    message: 'no lockup transaction found',
    code: concatErrorCode(ErrorCodePrefix.Ethereum, 0),
  }),
  INVALID_LOCKUP_TRANSACTION: (transactionHash: string): Error => ({
    message: `lockup transaction is invalid: ${transactionHash}`,
    code: concatErrorCode(ErrorCodePrefix.Ethereum, 1),
  }),
  UNEQUAL_PROVIDER_NETWORKS: (networks: providers.Network[]): Error => {
    const networkStrings: number[] = [];
    networks.forEach((network) => networkStrings.push(network.chainId));

    return {
      message: `not all web3 provider networks are equal: ${networkStrings.join(', ')}`,
      code: concatErrorCode(ErrorCodePrefix.Ethereum, 2),
    };
  },
  REQUESTS_TO_PROVIDERS_FAILED: (errors: string[]): Error => ({
    code: concatErrorCode(ErrorCodePrefix.Ethereum, 4),
    message: `requests to all providers failed:\n - ${errors.join('\\n - ')}`,
  }),
};
