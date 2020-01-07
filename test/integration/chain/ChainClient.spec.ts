import { OutputType } from 'boltz-core';
import { bitcoinClient } from '../Nodes';
import { getHexBuffer, reverseBuffer } from '../../../lib/Utils';
import { waitForFunctionToBeTrue, generateAddress } from '../../Utils';

describe('ChainClient', () => {
  const numTransactions = 15;

  let transactionWithRelevantInput = '';

  const testData = {
    inputs: [] as Buffer[],
    addresses: [] as string[],
    outputScripts: [] as Buffer[],
  };

  test('should connect', async () => {
    await bitcoinClient.connect();
  });

  test('should update the output filer', async () => {
    for (let i = 0; i < numTransactions; i += 1) {
      const { outputScript, address } = generateAddress(OutputType.Bech32);

      testData.outputScripts.push(outputScript);
      testData.addresses.push(address);
    }

    bitcoinClient.updateOutputFilter(testData.outputScripts);

    expect(bitcoinClient['zmqClient'].relevantOutputs.size).toEqual(numTransactions);
  });

  test('should emit an event on mempool acceptance of relevant output', async () => {
    let mempoolTransactions = 0;

    bitcoinClient.on('transaction', (_, confirmed) => {
      if (!confirmed) {
        mempoolTransactions += 1;
      }
    });

    for (const address of testData.addresses) {
      await bitcoinClient.sendToAddress(address, 1000);
    }

    await waitForFunctionToBeTrue(() => {
      return mempoolTransactions === numTransactions;
    });
  });

  test('should emit an event on block acceptance of relevant output', async () => {
    let blockTransactions = 0;

    bitcoinClient.on('transaction', async (_, confirmed) => {
      if (confirmed) {
        blockTransactions += 1;
      }
    });

    await bitcoinClient.generate(1);

    await waitForFunctionToBeTrue(() => {
      return blockTransactions === numTransactions;
    });
  });

  test('should update the input filer', async () => {
    const unspentUtxos = await bitcoinClient.listUnspent();

    for (const utxo of unspentUtxos) {
      testData.inputs.push(reverseBuffer(getHexBuffer(utxo.txid)));
    }

    bitcoinClient.updateInputFilter(testData.inputs);
    expect(bitcoinClient['zmqClient'].relevantInputs.size).toEqual(unspentUtxos.length);
  });

  test('should update the input filer', async () => {
    const unspentUtxos = await bitcoinClient.listUnspent();

    for (const utxo of unspentUtxos) {
      testData.inputs.push(reverseBuffer(getHexBuffer(utxo.txid)));
    }

    bitcoinClient.updateInputFilter(testData.inputs);
    expect(bitcoinClient['zmqClient'].relevantInputs.size).toEqual(unspentUtxos.length);
  });

  test('should emit an event on mempool acceptance of relevant inputs', async () => {
    let event = false;

    bitcoinClient.on('transaction', (transaction, confirmed) => {
      if (!confirmed && !event) {
        transaction.ins.forEach((input) => {
          let hasRelevantInput = false;

          // "testData.inputs.includes(input.hash)" does not work; therefore this loop is needed
          for (const relevantInput of testData.inputs) {
            if (input.hash.equals(relevantInput)) {
              hasRelevantInput = true;
            }
          }

          expect(hasRelevantInput).toBeTruthy();

          transactionWithRelevantInput = transaction.getId();
        });

        event = true;
      }
    });

    const { address } = generateAddress(OutputType.Bech32);
    await bitcoinClient.sendToAddress(address, 1000);

    await waitForFunctionToBeTrue(() => {
      return event;
    });
  });

  test('should emit an event on block acceptance of relevant inputs', async () => {
    let event = false;

    bitcoinClient.on('transaction', (transaction, confirmed) => {
      if (confirmed) {
        if (transaction.getId() === transactionWithRelevantInput) {
          event = true;
        }
      }
    });

    await bitcoinClient.generate(1);

    await waitForFunctionToBeTrue(() => {
      return event;
    });
  });

  test('should emit an event when a block gets mined', async () => {
    const generated = numTransactions;

    let blocks = 0;
    let bestBlockHeight = 0;

    bitcoinClient.on('block', (height: number) => {
      blocks += 1;
      bestBlockHeight = height;
    });

    await bitcoinClient.generate(generated);

    await waitForFunctionToBeTrue(() => {
      return blocks === generated;
    });

    const blockchainInfo = await bitcoinClient.getBlockchainInfo();

    expect(bestBlockHeight).toEqual(blockchainInfo.blocks);
  });

  afterAll(async () => {
    await bitcoinClient.disconnect();
  });
});
