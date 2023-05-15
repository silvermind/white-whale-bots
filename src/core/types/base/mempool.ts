import { fromAscii, fromBase64, fromUtf8, toUtf8 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { parseCoins } from "@cosmjs/stargate";
import { MsgExecuteContractCompat as MsgExecuteContractCompatBase } from "@injectivelabs/chain-api/injective/wasmx/v1/tx_pb";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";

import {
	isAstroSwapOperationsMessages,
	isWWSwapOperationsMessages,
	isWyndDaoSwapOperationsMessages,
} from "../messages/swapmessages";
import { Asset, fromChainAsset, isWyndDaoNativeAsset } from "./asset";

export interface Mempool {
	n_txs: string;
	total: string;
	total_bytes: string;
	txs: Array<string>;
}

export interface MempoolTx {
	message: MsgExecuteContract;
	txBytes: Uint8Array;
}

let txMemory: { [key: string]: boolean } = {};

/**
 *Flushes the already processed transactions from the mempool.
 */
export function flushTxMemory() {
	txMemory = {};
}

/**
 *
 */
export function showTxMemory() {
	console.log(Object.keys(txMemory).length);
}
/**
 *Filters the mempool for swaps, sends and swap operation messages.
 *@param mempool The mempool(state) to process.
 *@return An array of swap, send and swap-operation messages that exist in the `mempool`.
 */
export function decodeMempool(mempool: Mempool, ignoreAddresses: Record<string, boolean>): Array<MempoolTx> {
	const decodedMessages: Array<MempoolTx> = [];
	for (const tx of mempool.txs) {
		if (txMemory[tx] == true) {
			// the transaction is already processed and stored in the txMemory
			continue;
		}
		// set the transaction to processed in the txMemory
		txMemory[tx] = true;

		// decode transaction to readable object
		const txBytes = fromBase64(tx);
		const txRaw = decodeTxRaw(txBytes);
		for (const message of txRaw.body.messages) {
			let msgExecuteContract: MsgExecuteContract;

			switch (message.typeUrl) {
				case "/cosmos.bank.v1beta1.MsgSend": {
					const msgSend: MsgSend = MsgSend.decode(message.value);
					//if one of the spam wallets sends funds to a new wallet, add the new wallet to the ignore addresses
					if (ignoreAddresses[msgSend.fromAddress]) {
						ignoreAddresses[msgSend.toAddress] = true;
					}
					break;
				}

				case "/injective.wasmx.v1.MsgExecuteContractCompat": {
					const msgExecuteContractCompatBase: MsgExecuteContractCompatBase =
						MsgExecuteContractCompatBase.deserializeBinary(message.value);
					const funds = msgExecuteContractCompatBase.getFunds();
					msgExecuteContract = MsgExecuteContract.fromPartial({
						contract: msgExecuteContractCompatBase.getContract(),
						sender: msgExecuteContractCompatBase.getSender(),
						msg: toUtf8(msgExecuteContractCompatBase.getMsg()),
						funds: funds === "0" ? [] : parseCoins(funds),
					});

					//if the sender of the message is in our ignore list: skip this message
					if (ignoreAddresses[msgExecuteContract.sender]) {
						break;

						// if they use a contract to fund new wallets
					} else if (ignoreAddresses[msgExecuteContract.contract]) {
						const containedMsg = JSON.parse(fromUtf8(msgExecuteContract.msg));
						const gets = fromAscii(fromBase64(containedMsg.delegate.msg));
						ignoreAddresses[gets] = true;
						break;
						// message we should process
					} else {
						decodedMessages.push({ message: msgExecuteContract, txBytes: txBytes });
					}
					break;
				}
				case "/cosmwasm.wasm.v1.MsgExecuteContract": {
					msgExecuteContract = MsgExecuteContract.decode(message.value);

					//if the sender of the message is in our ignore list: skip this message
					if (ignoreAddresses[msgExecuteContract.sender]) {
						break;
						// if they use a contract to fund new wallets
					} else if (ignoreAddresses[msgExecuteContract.contract]) {
						const containedMsg = JSON.parse(fromUtf8(msgExecuteContract.msg));
						const gets = fromAscii(fromBase64(containedMsg.delegate.msg));
						ignoreAddresses[gets] = true;
						break;
						// message we should process
					} else {
						decodedMessages.push({ message: msgExecuteContract, txBytes: txBytes });
					}
					break;
				}
				default: {
					break;
				}
			}
		}
	}
	return decodedMessages;
}
/*

			// check if the message is a cw20-send message we want to add to the relevant trades
			else if (isSendMessage(containedMsg)) {
				try {
					const msgJson = JSON.parse(fromAscii(fromBase64(containedMsg.send.msg)));
					if (isSwapOperationsMessage(msgJson)) {
						const mempoolTrade = processSwapOperations(
							msgJson,
							txBytes,
							undefined,
							containedMsg.send.amount,
							containedMsg.send.contract,
						);
						if (mempoolTrade) {
							mempoolTrade.sender = msgExecuteContract.sender;
							mempoolTrades[0].push(mempoolTrade);
						}
						continue;
					} else if (isSwapMessage(msgJson)) {
						// swap message inside a send message
						const contract = containedMsg.send.contract;
						const token_addr = msgExecuteContract.contract;
						const offerAsset: Asset = {
							amount: containedMsg.send.amount,
							info: { token: { contract_addr: token_addr } },
						};
						mempoolTrades[0].push({
							contract: contract,
							message: containedMsg,
							offer_asset: fromChainAsset(offerAsset),
							txBytes: txBytes,
							sender: msgExecuteContract.sender,
						});
						continue;
					} else {
						continue;
					}
				} catch (e) {
					console.log("cannot apply send message");
					console.log(containedMsg.send);
				}
			} else if (isTFMSwapOperationsMessage(containedMsg)) {
				const offerAsset = {
					amount: containedMsg.execute_swap_operations.routes[0].offer_amount,
					info: containedMsg.execute_swap_operations.routes[0].operations[0].t_f_m_swap.offer_asset_info,
				};
				mempoolTrades[0].push({
					contract: containedMsg.execute_swap_operations.routes[0].operations[0].t_f_m_swap.pair_contract,
					message: containedMsg,
					offer_asset: fromChainAsset(offerAsset),
					txBytes: txBytes,
					sender: msgExecuteContract.sender,
				});
			} else if (isJunoSwapOperationsMessage(containedMsg)) {
				mempoolTrades[0].push({
					contract: msgExecuteContract.contract,
					message: containedMsg,
					offer_asset: undefined,
					txBytes: txBytes,
					sender: msgExecuteContract.sender,
				});
			}
			// check if the message is a swap-operations router message we want to add to the relevant trades
			else if (isSwapOperationsMessage(containedMsg)) {
				const mempoolTrade = processSwapOperations(containedMsg, txBytes, msgExecuteContract);
				if (mempoolTrade) {
					mempoolTrades[0].push(mempoolTrade);
				}
			} else if (ignoreAddresses[msgExecuteContract.contract]) {
				const gets = fromAscii(fromBase64(containedMsg.delegate.msg));
				mempoolTrades[1].push({ sender: msgExecuteContract.contract, reciever: gets });
			} else {
				continue;
			}
		}
	}

	return mempoolTrades;
}
*/

/**
 *
 */
function processSwapOperations(
	containedMsg: any,
	txBytes: Uint8Array,
	msgExecuteContract?: MsgExecuteContract,
	amount?: string,
	contractAddress?: string,
) {
	const operationsMessage = containedMsg.execute_swap_operations.operations;
	let offerAmount;
	let swapContract;
	if (msgExecuteContract !== undefined) {
		offerAmount = msgExecuteContract.funds[0].amount;
		swapContract = msgExecuteContract.contract;
	} else if (amount !== undefined && contractAddress != undefined) {
		offerAmount = amount;
		swapContract = contractAddress;
	} else {
		return undefined;
	}
	let offerAsset: Asset;
	if (isWWSwapOperationsMessages(operationsMessage)) {
		offerAsset = { amount: offerAmount, info: operationsMessage[0].terra_swap.offer_asset_info };
		return {
			contract: swapContract,
			message: containedMsg,
			offer_asset: fromChainAsset(offerAsset),
			txBytes: txBytes,
			sender: msgExecuteContract?.sender,
		};
	}
	if (isAstroSwapOperationsMessages(operationsMessage)) {
		offerAsset = { amount: offerAmount, info: operationsMessage[0].astro_swap.offer_asset_info };
		return {
			contract: swapContract,
			message: containedMsg,
			offer_asset: fromChainAsset(offerAsset),
			txBytes: txBytes,
			sender: msgExecuteContract?.sender,
		};
	}
	if (isWyndDaoSwapOperationsMessages(operationsMessage)) {
		if (isWyndDaoNativeAsset(operationsMessage[0].wyndex_swap.offer_asset_info)) {
			offerAsset = {
				amount: offerAmount,
				info: {
					native_token: { denom: operationsMessage[0].wyndex_swap.offer_asset_info.native },
				},
			};
		} else {
			offerAsset = {
				amount: offerAmount,
				info: {
					token: { contract_addr: operationsMessage[0].wyndex_swap.offer_asset_info.token },
				},
			};
		}
		return {
			contract: swapContract,
			message: containedMsg,
			offer_asset: fromChainAsset(offerAsset),
			txBytes: txBytes,
			sender: msgExecuteContract?.sender,
		};
	}
}
