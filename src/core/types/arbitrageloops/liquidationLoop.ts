import { fromUtf8 } from "@cosmjs/encoding";

import { ChainOperator } from "../../chainOperator/chainoperator";
import { BotConfig } from "../base/botConfig";
import { decodeMempool, IgnoredAddresses, Mempool, MempoolTx } from "../base/mempool";
import { AnchorOverseer, processPriceFeed } from "../base/overseer";
import { PriceFeedMessage } from "../messages/pricefeedmessage";
/**
 *
 */
export class LiquidationLoop {
	botConfig: BotConfig;
	chainOperator: ChainOperator;
	ignoreAddresses: IgnoredAddresses = {};
	iterations = 0;
	mempool!: Mempool;
	overseers: Array<AnchorOverseer>;
	totalBytes = 0;
	allOverseerAddresses: Record<string, AnchorOverseer> = {};
	allOverseerPriceFeeders: Record<string, AnchorOverseer> = {};
	allOverseerMoneyMarkets: Record<string, AnchorOverseer> = {};

	/**
	 *
	 */
	constructor(chainOperator: ChainOperator, botConfig: BotConfig, overseers: Array<AnchorOverseer>) {
		this.botConfig = botConfig;
		this.overseers = overseers;
		this.chainOperator = chainOperator;

		overseers.map((overseer) => {
			this.allOverseerAddresses[overseer.overseerAddress] = overseer;
			if (overseer.priceFeeders) {
				for (const priceFeedAddress of overseer.priceFeeders) {
					this.allOverseerPriceFeeders[priceFeedAddress] = overseer;
				}
			}
			this.allOverseerMoneyMarkets[overseer.marketAddress] = overseer;
		});
	}

	/**
	 *
	 */
	public async step() {
		while (true) {
			this.mempool = await this.chainOperator.queryMempool();

			if (+this.mempool.total_bytes < this.totalBytes) {
				break;
			} else if (+this.mempool.total_bytes === this.totalBytes) {
				continue;
			} else {
				this.totalBytes = +this.mempool.total_bytes;
			}
		}

		const mempoolTxs: Array<MempoolTx> = decodeMempool(this.mempool, this.ignoreAddresses, this.iterations);
	}

	/**
	 *
	 */
	applyMempoolMessagesOnLiquidation(mempoolTxs: Array<MempoolTx>) {
		for (const tx of mempoolTxs) {
			const pf = this.allOverseerPriceFeeders[tx.message.contract];
			if (pf) {
				const pfMessage: PriceFeedMessage = JSON.parse(fromUtf8(tx.message.msg));
				processPriceFeed(pfMessage, pf.priceFeed);
				continue;
			} else {
				const overseer = this.allOverseerAddresses[tx.message.contract];
				if (overseer) {
					//its an overseer message
					// do something
					continue;
				} else {
					const mm = this.allOverseerMoneyMarkets[tx.message.contract];
					if (mm) {
						//its an money market message
						//do something
						continue;
					}
				}
			}
		}
	}
}
