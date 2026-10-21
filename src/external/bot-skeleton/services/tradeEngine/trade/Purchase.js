import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type, prediction) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            // A single purchase is not a pair any more.
            this.pair = null;

            // A strategy imported from another builder can arrive with its
            // contract-type dropdown empty (the options are filled in from the
            // trade definition when the block is drawn, not when the XML is
            // read). The definition already fixes the contract type this trade
            // buys, so use it instead of sending an order with no type — which
            // the API rejects and which used to stop the whole bot.
            if (!contract_type || contract_type === 'undefined' || contract_type === 'null') {
                contract_type = this.tradeOptions?.contract_type;
            }
            if (!contract_type) {
                return Promise.resolve();
            }

            // The Apollo purchase block may pass an explicit prediction
            // (e.g. for Over/Under/Matches/Differs digit contracts).
            if (prediction !== undefined && prediction !== null) {
                this.tradeOptions = { ...this.tradeOptions, prediction };
            }

            // Strategy blocks (Concept Block / Contract Sequence) and the
            // Apollo contract changer may override the contract type chosen by
            // the purchase block and may block the purchase entirely until
            // their conditions are met.
            if (this._nextContractType) {
                contract_type = this._nextContractType;
                if ((contract_type === 'DIGITEVEN' || contract_type === 'DIGITODD') && this.tradeOptions) {
                    delete this.tradeOptions.prediction;
                    delete this.tradeOptions.barrier;
                }
            } else if (this._contractSequenceActive && this.tradeOptions?.contract_type) {
                contract_type = this.tradeOptions.contract_type;
            } else if (this._conceptBlockActive && this.tradeOptions?.contract_type) {
                contract_type = this.tradeOptions.contract_type;
            }
            if (
                (this._contractSequenceBlocked || this._conceptBlockBlocked) &&
                (this._contractSequenceActive || this._conceptBlockActive)
            ) {
                return Promise.resolve();
            }

            const onSuccess = response => this.handlePurchaseReceived(response.buy, contract_type);

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        /**
         * The order was accepted: hand the contract to the engine so the bot's
         * during/after-purchase flow, totals and journal follow it.
         */
        handlePurchaseReceived(buy, contract_type) {
            contractStatus({
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });

            this.contractId = buy.contract_id;
            this.store.dispatch(purchaseSuccessful());

            if (this.is_proposal_subscription_required) {
                this.renewProposalsOnPurchase();
            }

            delayIndex = 0;
            log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
            info({
                accountID: this.accountInfo.loginid,
                totalRuns: this.updateAndReturnTotalRuns(),
                transaction_ids: { buy: buy.transaction_id },
                contract_type,
                buy_price: buy.buy_price,
            });
        }

        /** The contract type a purchase step asked for, falling back to the trade definition. */
        resolvePurchaseContractType(contract_type) {
            if (!contract_type || contract_type === 'undefined' || contract_type === 'null') {
                return this.tradeOptions?.contract_type || '';
            }
            return contract_type;
        }

        buyProposal({ id, askPrice }) {
            return api_base.api.send({ buy: id, price: askPrice });
        }

        /**
         * Buy two contracts at the same moment — the Purchase two contracts
         * block, e.g. Rise and Fall together.
         *
         * Both orders are sent together, from the proposals the trade definition
         * already holds (so they share the configured stake and duration). The
         * first contract drives the bot's normal flow — during/after purchase,
         * totals, the journal — and the second is followed to settlement on its
         * own so both sides land in the totals.
         */
        async purchasePair(contract_type, second_contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const first_type = this.resolvePurchaseContractType(contract_type);
            const second_type = this.resolvePurchaseContractType(second_contract_type);

            // A blank or repeated side is just a normal single purchase.
            if (!first_type || !second_type || first_type === second_type) {
                return this.purchase(first_type || second_type);
            }

            let first_quote;
            let second_quote;
            try {
                first_quote = this.selectProposal(first_type);
                second_quote = this.selectProposal(second_type);
            } catch (error) {
                // Only one side could be priced: buy that one instead of skipping
                // the trade entirely. The other proposal is logged by Proposal.js.
                return this.purchase(first_type);
            }

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: first_quote.askPrice + second_quote.askPrice,
            });

            const orders = [
                { contract_type: first_type, quote: first_quote },
                { contract_type: second_type, quote: second_quote },
            ];

            // Both sends go out together; one refusal must not lose the other.
            const results = await Promise.allSettled(orders.map(order => this.buyProposal(order.quote)));
            const bought = results
                .map((result, index) =>
                    result.status === 'fulfilled' && result.value?.buy
                        ? { buy: result.value.buy, contract_type: orders[index].contract_type }
                        : null
                )
                .filter(Boolean);

            if (!bought.length) {
                const failed = results.find(result => result.status === 'rejected');
                throw failed ? failed.reason : new Error('Both purchases were refused');
            }

            const [primary, secondary] = bought;
            // Remember the pair so its result can be read once both settle.
            this.pair = {
                secondary: secondary ? secondary.buy.contract_id : null,
                secondary_profit: null,
            };
            this.handlePurchaseReceived(primary.buy, primary.contract_type);
            if (secondary) {
                this.trackSecondContract(secondary.buy);
            }

            return undefined;
        }

        /**
         * Follow the second contract of a pair to settlement. It is not the
         * contract the bot's flow waits on, so it is tracked here: its result
         * still lands in the totals and in the contract broadcast.
         */
        trackSecondContract(buy) {
            const contract_id = buy?.contract_id;
            if (!contract_id || !api_base.api) return;

            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data?.msg_type !== 'proposal_open_contract') return;
                const contract = data.proposal_open_contract;
                if (!contract || contract.contract_id !== contract_id || !contract.is_sold) return;

                try {
                    subscription.unsubscribe();
                } catch (error) {
                    // the socket may already be gone; nothing left to follow
                }

                if (this.pair) {
                    this.pair.secondary_profit = Number(contract.profit) || 0;
                }
                this.updateTotals(contract);
                broadcastContract({ accountID: api_base.account_info.loginid, ...contract });
            });

            api_base.pushSubscription(subscription);
        }

        /**
         * How the pair did: "loss" only when both contracts lost, otherwise
         * "win". Waits for the second contract to settle, since the two
         * settlements arrive a moment apart even though they share a tick.
         */
        async getPairResult() {
            const primary_profit = Number(this.data?.contract?.profit) || 0;
            if (!this.pair) {
                return primary_profit > 0 ? 'win' : 'loss';
            }

            const deadline = Date.now() + 10000;
            while (this.pair.secondary && this.pair.secondary_profit === null && Date.now() < deadline) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const secondary_profit = Number(this.pair.secondary_profit) || 0;
            return primary_profit > 0 || secondary_profit > 0 ? 'win' : 'loss';
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
