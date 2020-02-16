import { Op } from 'sequelize';
import AsyncLock from 'async-lock';
import { EventEmitter } from 'events';
import { Transaction, TxOutput, address } from 'bitcoinjs-lib';
import Errors from './Errors';
import Logger from '../Logger';
import Swap from '../db/models/Swap';
import SwapNursery from '../swap/SwapNursery';
import SwapRepository from '../db/SwapRepository';
import { SwapUpdateEvent } from '../consts/Enums';
import ReverseSwap from '../db/models/ReverseSwap';
import { Currency } from '../wallet/WalletManager';
import ReverseSwapRepository from '../db/ReverseSwapRepository';

type TransactionInfo = {
  eta?: number;

  id: string;
  hex: string;
};

type SwapUpdate = {
  status: SwapUpdateEvent;

  transaction?: TransactionInfo;
};

interface EventHandler {
  on(event: 'swap.update', listener: (id: string, message: SwapUpdate) => void): this;
  emit(event: 'swap.update', id: string, message: SwapUpdate): boolean;

  on(event: 'swap.success', listener: (swap: Swap | ReverseSwap, isReverse: boolean) => void): this;
  emit(event: 'swap.success', swap: Swap | ReverseSwap, isReverse: boolean): boolean;

  on(event: 'swap.failure', listener: (reverseSwap: Swap | ReverseSwap, isReverse: boolean, reason: string) => void): this;
  emit(event: 'swap.failure', reverseSwap: Swap | ReverseSwap, isReverse: boolean, reason: string): boolean;

  on(event: 'channel.backup', listener: (currency: string, channelBackup: string) => void): this;
  emit(event: 'channel.backup', currency: string, channelbackup: string): boolean;
}

class EventHandler extends EventEmitter {
  private lock = new AsyncLock();

  private static reverseSwapLock = 'reverseSwap';

  constructor(
    private logger: Logger,
    private currencies: Map<string, Currency>,
    private nursery: SwapNursery,
    private swapRepository: SwapRepository,
    private reverseSwapRepository: ReverseSwapRepository,
  ) {
    super();

    this.subscribeInvoices();
    this.subscribeSwapEvents();
    this.subscribeTransactions();
    this.subscribeChannelBackups();
  }

  public emitSwapCreation = (id: string) => {
    this.emit('swap.update', id, { status: SwapUpdateEvent.SwapCreated });
  }

  /**
   * Subscribes to a stream of confirmed transactions to addresses that were specified with "ListenOnAddress"
   */
  private subscribeTransactions = () => {
    this.nursery.on('transaction', (transaction, swap, confirmed, isReverse) => {
      if (!isReverse) {
        this.emit('swap.update', swap.id, {
          status: confirmed ? SwapUpdateEvent.TransactionConfirmed : SwapUpdateEvent.TransactionMempool,
        });
      } else {
        this.emit('swap.update', swap.id, {
          status: SwapUpdateEvent.TransactionConfirmed,
          transaction: {
            id: transaction.getId(),
            hex: transaction.toHex(),
          },
        });
      }
    });
  }

  /**
   * Subscribes to a stream of settled invoices and those paid by Boltz
   */
  private subscribeInvoices = () => {
    this.nursery.on('invoice.settled', (swap) => {
      this.logger.verbose(`Reverse swap ${swap.id} succeeded`);

      this.emit('swap.update', swap.id, { status: SwapUpdateEvent.InvoiceSettled });
      this.emit('swap.success', swap, true);
    });

    this.nursery.on('invoice.paid', (swap) => {
      this.emit('swap.update', swap.id, { status: SwapUpdateEvent.InvoicePaid });
    });

    this.nursery.on('invoice.failedToPay', (swap) => {
      this.handleFailedSwap(swap, Errors.INVOICE_COULD_NOT_BE_PAID().message, SwapUpdateEvent.InvoiceFailedToPay);
    });
  }

  /**
   * Subscribes to a stream of swap events
   */
  private subscribeSwapEvents = () => {
    this.nursery.on('claim', (swap) => {
      this.logger.verbose(`Swap ${swap.id} succeeded`);

      this.emit('swap.update', swap.id, { status: SwapUpdateEvent.TransactionClaimed });
      this.emit('swap.success', swap, false);
    });

    this.nursery.on('expiration', (swap) => {
      const newStatus = SwapUpdateEvent.SwapExpired;
      const error = Errors.ONCHAIN_HTLC_TIMED_OUT().message;

      if (swap instanceof Swap) {
        this.handleFailedSwap(swap, error, newStatus);
      } else {
        this.handleFailedReverseSwap(swap, error, newStatus);
      }
    });

    this.nursery.on('coins.sent', (reverseSwap, transaction) => {
      this.emit('swap.update', reverseSwap.id, {
        status: SwapUpdateEvent.TransactionMempool,
        transaction: {
          id: reverseSwap.transactionId,
          hex: transaction.toHex(),
          eta: SwapNursery.reverseSwapMempoolEta,
        },
      });
    });

    this.nursery.on('coins.failedToSend', (reverseSwap) => {
      this.handleFailedReverseSwap(reverseSwap, Errors.COINS_COULD_NOT_BE_SENT().message, SwapUpdateEvent.TransactionFailed);
    });

    this.nursery.on('refund', (reverseSwap) => {
      this.handleFailedReverseSwap(reverseSwap, Errors.ONCHAIN_HTLC_TIMED_OUT().message, SwapUpdateEvent.TransactionRefunded);
    });
  }

  /**
   * Subscribes to a a stream of channel backups
   */
  private subscribeChannelBackups = () => {
    this.currencies.forEach((currency) => {
      if (currency.lndClient) {
        const { symbol, lndClient } = currency;

        lndClient.on('channel.backup', (channelBackup: string) => {
          this.emit('channel.backup', symbol, channelBackup);
        });
      }
    });
  }

  private handleFailedSwap = (swap: Swap, reason: string, status: SwapUpdateEvent) => {
    this.logger.warn(`Swap ${swap.id} failed: ${reason}`);

    this.emit('swap.update', swap.id, { status });
    this.emit('swap.failure', swap, false, reason);
  }

  private handleFailedReverseSwap = (reverseSwap: ReverseSwap, reason: string, status: SwapUpdateEvent) => {
    this.logger.warn(`Reverse swap ${reverseSwap.id} failed: ${reason}`);

    this.emit('swap.update', reverseSwap.id, { status });
    this.emit('swap.failure', reverseSwap, true, reason);
  }
}

export default EventHandler;
export { SwapUpdate };
