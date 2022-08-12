import "./openapi/api";
import "reflect-metadata";
import { DataSource, Repository } from "typeorm";
import { TokenToAddress } from "./entity/TokenToAddress";
import { SendQueue } from "./entity/SendQueue";
import { KeyValue } from "./entity/KeyValue";
import { TokenToTxid } from "./entity/TokenToTxid";
import { Network, Transaction } from "./types";
import { getDataSource } from "./database";
import BitcoinNetwork from "./networks/bitcoin";
import PushNotificationOnchainAddressGotPaid = Components.Schemas.PushNotificationOnchainAddressGotPaid;

require("dotenv").config();

process
  .on("unhandledRejection", (reason, p) => {
    console.error(reason, "Unhandled Rejection at Promise", p);
    process.exit(1);
  })
  .on("uncaughtException", (err) => {
    console.error(err, "Uncaught Exception thrown");
    process.exit(1);
  });

const groupByKey = <T>(list: T[], key: string) => list.reduce((hash, obj: any) => (
  { ...hash, [obj[key]]: (hash[obj[key]] || []).concat(obj) }), {} as {[key: string]: T[]});

async function processTransactions(transactions: Transaction[], sendQueueRepository: Repository<SendQueue>) {
  // checking if there is a subscription to one of the mined txids:
  const includedTransactionIds = transactions.map((tx) => tx.transactionId);
  if (includedTransactionIds.length) {
    const query2 = ds.getRepository(TokenToTxid).createQueryBuilder().where("txid IN (:...txids)", { txids: includedTransactionIds });
    for (const t2txid of await query2.getMany()) {
      const payload: Components.Schemas.PushNotificationTxidGotConfirmed = {
        txid: t2txid.txid,
        type: 4,
        level: "transactions",
        token: t2txid.token,
        os: t2txid.os === "ios" ? "ios" : "android",
        badge: 1,
      };

      process.env.VERBOSE && console.log("enqueueing", payload);
      await sendQueueRepository.save({
        data: JSON.stringify(payload),
      });
    }
  }

  // now handle the events of each transaction
  const affectedAddresses = transactions.flatMap((tx) => tx.events.map((event) => event.address));
  if (!affectedAddresses.length) {
    return;
  }

  // Find any tokens
  const query = ds.getRepository(TokenToAddress).createQueryBuilder().where("address IN (:...address)", { address: affectedAddresses });
  const tokensByAddress = groupByKey(await query.getMany(), "address");

  for (let transaction of transactions) {
    for (let event of transaction.events) {
      const token = tokensByAddress[event.address]?.[0];

      // Ignore any for which we have no subscription.
      if (!token) {
        continue;
      }

      const payload: PushNotificationOnchainAddressGotPaid = {
        address: event.address,
        level: "transactions",
        os: token.os as any,
        token: token.token,
        sat: parseInt(event.amount),
        txid: transaction.transactionId,
        type: 2,
        badge: 1,
      };
      process.env.VERBOSE && console.log("enqueueing", payload);
      await sendQueueRepository.save({
        data: JSON.stringify(payload),
      });
    }
  }
}

export function getBitcoinNetwork() {
  if (!process.env.BITCOIN_RPC) {
    console.error("BITCOIN_RPC env variable not set");
    process.exit();
  }

  return new BitcoinNetwork(process.env.BITCOIN_RPC);
}

const ds = getDataSource();
ds.connect()
  .then(async (connection) => {
    // start worker
    console.log("running groundcontrol worker-blockprocessor");
    console.log(require("fs").readFileSync("./bowie.txt").toString("ascii"));

    // TODO: Add CLI options/env variables to allow selecting a network.
    // Values to be provided:
    //   - a network id per https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-2.md
    //   - an rpc url or any other config values required to serve the network.
    const network: Network = getBitcoinNetwork();

    const KeyValueRepository = ds.getRepository(KeyValue);
    const sendQueueRepository = ds.getRepository(SendQueue);
    const lastProcessedBlockKey = `LAST_PROCESSED_BLOCK/${network.id}`;

    const queryState = async () => {
      const v = (await KeyValueRepository.findOneBy({ key: lastProcessedBlockKey }))?.value;
      return v ? parseInt(v) : null;
    };
    const saveState = async (state: number) => {
      await KeyValueRepository.save({ key: lastProcessedBlockKey, value: state.toString() });
    };

    for await (const block of network.iterateBlocks(await queryState())) {
      console.log('processing', block)
      const start = +new Date();

      const transactions = await network.processBlock(block);
      await processTransactions(transactions, sendQueueRepository);

      const end = +new Date();
      console.log("took", (end - start) / 1000, "sec");
      await saveState(block);
    }
  })
  .catch((error) => {
    console.error("exception in blockprocessor:", error, "comitting suicide");
    process.exit(1);
  });
