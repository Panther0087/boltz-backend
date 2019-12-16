import { OutputType } from 'boltz-core';
import { bitcoinClient } from '../Nodes';
import { waitForFunctionToBeTrue, generateAddress } from '../../Utils';

describe('ChainClient', () => {
  const numTransactions = 15;

  const testData = {
    outputScripts: [] as Buffer[],
    addresses: [] as string[],
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
  });

  test('should emit an event on mempool acceptance', async () => {
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

  test('should emit an event on block acceptance', async () => {
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
