/**
 * Strategy.js — strategy engine powering the custom strategy blocks
 * ported from globaltrades.site (Concept Block, Contract Sequence,
 * volatility market rotation).
 *
 * The generated bot code calls these through the Bot interface:
 *   Bot.applyConceptBlock(ticks, threshold, over, under, waitBeforeScan, cooldown, winStreakLock, lockThreshold);
 *   Bot.applyContractSequenceDiff0Over12Streak2();
 *   Bot.rotateToNextVolatilityMarket();
 *
 * Each strategy decides the contract type + prediction for the upcoming
 * purchase (via setNextContractType) and can "block" the purchase until
 * conditions are met (purchase is skipped while blocked).
 */
import { observer as globalObserver } from '../../../utils/observer';

const VOLATILITY_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

const DEFAULT_PIP_SIZES = {
    R_10: 3,
    R_25: 3,
    R_50: 2,
    R_75: 2,
    R_100: 2,
    '1HZ10V': 3,
    '1HZ25V': 3,
    '1HZ50V': 2,
    '1HZ75V': 2,
    '1HZ100V': 2,
};

// Contract sequence presets (only the ones exposed by registered blocks are
// reachable, but the engine supports the full set for future blocks).
const SEQUENCE_PRESETS = {
    differ_over: {
        stepCount: 4,
        recoveryOnLoss: false,
        steps: { 1: 'differ', 2: 'over1', 3: 'over2', 4: 'differ' },
    },
    over_012: {
        stepCount: 3,
        recoveryOnLoss: true,
        recoveryMode: 'bias',
        steps: { 1: 'over0', 2: 'over1', 3: 'over2' },
    },
    over_012_streak: {
        stepCount: 3,
        recoveryOnLoss: true,
        recoveryMode: 'streak',
        steps: { 1: 'over0', 2: 'over1', 3: 'over2' },
    },
    diff0_over12_streak2: {
        stepCount: 3,
        recoveryOnLoss: true,
        recoveryMode: 'streak',
        recoveryStreakLength: 2,
        steps: { 1: 'differ0', 2: 'over1', 3: 'over2' },
    },
    diff0_over12_diff9_u87: {
        stepCount: 6,
        recoveryOnLoss: true,
        recoveryMode: 'streak',
        steps: { 1: 'differ0', 2: 'over1', 3: 'over2', 4: 'differ9', 5: 'under8', 6: 'under7' },
    },
    differ_coldest_streak: {
        stepCount: 1,
        recoveryOnLoss: true,
        recoveryMode: 'streak',
        steps: { 1: 'differ' },
    },
};

const clampInt = (value, def, min, max) => {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? def : Math.min(max, Math.max(min, n));
};

const positiveNum = (value, def) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : def;
};

const overPct = (digits, barrier) => {
    if (!digits || !digits.length) return 0;
    return (digits.filter(d => d > barrier).length / digits.length) * 100;
};

const underPct = (digits, barrier) => {
    if (!digits || !digits.length) return 0;
    return (digits.filter(d => d < barrier).length / digits.length) * 100;
};

const evenOddPct = digits => {
    if (!digits.length) return { evenPct: 0, oddPct: 0 };
    const evenPct = (digits.filter(d => d % 2 === 0).length / digits.length) * 100;
    return { evenPct, oddPct: 100 - evenPct };
};

const coldestDigit = digits => {
    if (digits.length < 1) return 0;
    const window = digits.slice(-15);
    const counts = Array(10).fill(0);
    window.forEach(d => {
        counts[d] += 1;
    });
    const min = Math.min(...counts);
    return counts.indexOf(min);
};

const lastNAllEven = (digits, n) => !!digits?.length && digits.length >= n && digits.slice(-n).every(d => d % 2 === 0);

const lastNAllOdd = (digits, n) => !!digits?.length && digits.length >= n && digits.slice(-n).every(d => d % 2 !== 0);

/** Volatility indices a market-switch block can move to. */
const HOOK_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

/**
 * The money8gg fork's entry triggers, read off the fork's own block fields.
 *
 * `under` / `over` / `equals` look at the last `count` digits (all of them have
 * to satisfy the comparison); `equals_any` looks at the last `set_size` digits
 * and accepts each one that belongs to the block's digit set; `instant` is true
 * as soon as the block runs.
 */
const triggerMet = ({ trigger, digits, value, count = 1, set = [] }) => {
    const wanted = clampInt(count, 1, 1, 100);
    if (trigger === 'instant') return true;
    if (trigger === 'equals_any') {
        const size = clampInt(set.length, wanted, 1, 100);
        if (digits.length < size) return false;
        return digits.slice(-size).every(digit => set.includes(digit));
    }
    if (digits.length < wanted) return false;
    const window = digits.slice(-wanted);
    if (trigger === 'under' || trigger === 'digit_under') return window.every(digit => digit < value);
    if (trigger === 'over' || trigger === 'digit_over') return window.every(digit => digit > value);
    if (trigger === 'equals') return window.every(digit => digit === value);
    return false;
};

const notify = message => {
    globalObserver.emit('ui.log.notify', {
        className: 'journal__text--info',
        message: `[Strategy] ${message}`,
        sound: 'silent',
        block_id: 'strategy-engine',
        variable_name: null,
    });
};

export default Engine =>
    class Strategy extends Engine {
        /* ------------------------------------------------------------------
         * Shared helpers
         * ---------------------------------------------------------------- */
        resetStrategyState() {
            this._contractSeq = undefined;
            this._contractSequenceActive = false;
            this._contractSequenceAwaitingSettlement = false;
            this._contractSequenceBlocked = false;
            this._conceptBlockActive = false;
            this._conceptBlockBlocked = false;
            this._conceptBelowCount = 0;
            this._conceptCooldownRemaining = 0;
            this._conceptLockRemaining = 0;
            this._conceptLockThreshold = null;
            this._nextContractType = null;
            this._tradeRepeat = 1;
            this._activeHook = null;
            this._hookInRecovery = false;
            this._hookSignalFired = false;
            this._virtualStage = 'immediate';
            this._virtualRetriesLeft = 0;
        }

        /* ------------------------------------------------------------------
         * Apollo blocks (symbol changer / contract changer / apollo purchase)
         * ---------------------------------------------------------------- */
        async setActiveSymbol(symbol) {
            if (!symbol || symbol === 'disable' || symbol === 'none') {
                return;
            }
            await this.setMarket(symbol);
        }

        async setContractType(contractType) {
            this._nextContractType = contractType || null;
        }

        async apolloPurchase(contractType, multipleContracts = false, quantity = 1) {
            if (this._nextContractType) {
                contractType = this._nextContractType;
            }
            if (this._contractSequenceActive && this.tradeOptions?.contract_type) {
                contractType = this.tradeOptions.contract_type;
            } else if (this._conceptBlockActive && this.tradeOptions?.contract_type) {
                contractType = this.tradeOptions.contract_type;
            }
            // A bot exported from another builder can arrive with an empty
            // contract-type dropdown (its options only fill in once the trade
            // definition is present). Buying the contract type chosen in Trade
            // parameters is the only order that definition allows anyway, and
            // it keeps the bot trading instead of failing on an empty type.
            if (!contractType || contractType === 'undefined' || contractType === 'null') {
                contractType = this.tradeOptions?.contract_type || '';
            }
            if (!contractType) {
                notify('Apollo purchase skipped: no contract type in the block or Trade parameters');
                return;
            }
            const count = multipleContracts && Number(quantity) > 1 ? Math.min(Number(quantity), 50) : 1;
            for (let i = 0; i < count; i += 1) {
                await this.purchase(contractType);
            }
        }

        async getDigitsForStrategy(n) {
            const count = clampInt(n, 15, 1, 1000);
            const ticks = await this.getTicks();
            const symbol = this.tradeOptions?.symbol || this.options?.symbol || 'R_50';
            const pip = typeof this.getPipSize === 'function' ? this.getPipSize() : DEFAULT_PIP_SIZES[symbol] ?? 2;
            return ticks.slice(-count).map(q => Math.round(Math.abs(Number(q)) * 10 ** pip) % 10);
        }

        getCurrentSymbol() {
            return this.tradeOptions?.symbol || this.options?.symbol || '';
        }

        async setMarket(symbol) {
            if (!symbol) return;
            if (this.tradeOptions) {
                this.tradeOptions.symbol = symbol;
            }
            if (this.options) {
                this.options.symbol = symbol;
            }
            if (typeof this.watchTicks === 'function') {
                await this.watchTicks(symbol);
            }
        }

        async rotateToNextVolatilityMarket() {
            const current = this.getCurrentSymbol();
            const idx = VOLATILITY_SYMBOLS.indexOf(current);
            const next = idx >= 0 ? VOLATILITY_SYMBOLS[(idx + 1) % VOLATILITY_SYMBOLS.length] : VOLATILITY_SYMBOLS[0];
            notify(`Rotating market ${current || '—'} → ${next}`);
            await this.setMarket(next);
        }

        setNextContractType(type, prediction) {
            if (!this.tradeOptions) return;
            this.tradeOptions = { ...this.tradeOptions, contract_type: type };
            const value = prediction !== undefined && prediction !== '' ? Number(prediction) : undefined;
            if (type === 'DIGITEVEN' || type === 'DIGITODD') {
                delete this.tradeOptions.prediction;
                delete this.tradeOptions.barrier;
                return;
            }
            if (value === undefined || Number.isNaN(value)) return;
            this.tradeOptions.prediction = value;
            this.tradeOptions.barrier = value;
        }

        /* ------------------------------------------------------------------
         * Concept Block
         * ---------------------------------------------------------------- */
        async applyConceptBlock(
            ticks = 15,
            threshold = 70,
            over = 2,
            under = 7,
            waitBeforeScan = 5,
            cooldown = 3,
            winStreakLock = 3,
            lockThreshold = 80
        ) {
            this._conceptBlockActive = true;
            this._conceptBlockBlocked = false;

            const g = clampInt(ticks, 15, 1, 1000);
            const thr = positiveNum(threshold, 70);
            const overBarrier = clampInt(over, 2, 0, 9);
            const underBarrier = clampInt(under, 7, 0, 9);
            const scanCount = clampInt(waitBeforeScan, 5, 1, 100);
            const cooldownTicks = clampInt(cooldown, 3, 0, 100);
            const winLock = clampInt(winStreakLock, 3, 0, 50);
            const lockThr = positiveNum(lockThreshold, 80);

            this._conceptCooldownTicks = cooldownTicks;
            this._conceptWinStreakLock = winLock;
            this._conceptConfiguredLockThreshold = lockThr;
            this._conceptLockDuration = 5;

            if ((this._conceptCooldownRemaining || 0) > 0) {
                this._conceptCooldownRemaining -= 1;
                this._conceptBlockBlocked = true;
                return false;
            }

            let digits = [];
            try {
                digits = await this.getDigitsForStrategy(g);
            } catch {
                digits = [];
            }
            if (digits.length < g) {
                this._conceptBlockBlocked = true;
                return false;
            }

            const overPercent = overPct(digits, overBarrier);
            const underPercent = underPct(digits, underBarrier);
            let targetThreshold = thr;
            if ((this._conceptLockRemaining || 0) > 0) {
                targetThreshold = this._conceptLockThreshold ?? lockThr;
                this._conceptLockRemaining -= 1;
            }

            const lastDigit = digits[digits.length - 1];
            const overHit = overPercent >= targetThreshold && lastDigit > overBarrier;
            const underHit = underPercent >= targetThreshold && lastDigit < underBarrier;

            if (overHit && (!underHit || overPercent >= underPercent)) {
                this.setNextContractType('DIGITOVER', overBarrier);
                this._conceptBelowCount = 0;
                return true;
            }
            if (underHit) {
                this.setNextContractType('DIGITUNDER', underBarrier);
                this._conceptBelowCount = 0;
                return true;
            }

            if (overPercent < targetThreshold && underPercent < targetThreshold) {
                this._conceptBelowCount = (this._conceptBelowCount || 0) + 1;
                if (this._conceptBelowCount >= scanCount) {
                    this._conceptBelowCount = 0;
                    try {
                        await this.rotateToNextVolatilityMarket();
                    } catch {
                        // rotation is best-effort
                    }
                }
            }
            this._conceptBlockBlocked = true;
            return false;
        }

        _conceptBlockSettlement(isWin) {
            if (!this._conceptBlockActive) return;
            if (!isWin) {
                this._conceptCooldownRemaining = this._conceptCooldownTicks ?? 3;
                this._conceptBelowCount = 0;
                return;
            }
            const winLock = this._conceptWinStreakLock ?? 3;
            const consecutiveWins = this._consecutiveWins || 0;
            if (winLock > 0 && consecutiveWins >= winLock) {
                this._conceptLockRemaining = this._conceptLockDuration ?? 5;
                this._conceptLockThreshold = this._conceptConfiguredLockThreshold ?? 80;
            }
        }

        /* ------------------------------------------------------------------
         * Contract Sequence
         * ---------------------------------------------------------------- */
        async applyContractSequenceDiff0Over12Streak2() {
            return this._applyContractSequence('diff0_over12_streak2');
        }

        async _applyContractSequence(preset) {
            if (!SEQUENCE_PRESETS[preset]) preset = 'differ_over';

            if (!this._contractSeq) {
                this._contractSeq = { step: 1, preset, inRecovery: false, _recoveryFired: false };
            } else if (this._contractSeq.preset !== preset) {
                this._contractSeq = { step: 1, preset, inRecovery: false, _recoveryFired: false };
            }

            this._contractSequenceActive = true;
            this._contractSequenceBlocked = false;

            const def = SEQUENCE_PRESETS[preset];
            let digits = [];
            try {
                digits = await this.getDigitsForStrategy(15);
            } catch {
                digits = [];
            }

            if (def.recoveryOnLoss && this._contractSeq.inRecovery) {
                const ok =
                    def.recoveryMode === 'streak'
                        ? await this._sequenceRecoveryStreak(digits, preset)
                        : await this._sequenceRecoveryBias(digits);
                if (ok) {
                    this._contractSequenceAwaitingSettlement = true;
                    return true;
                }
                return false;
            }

            const step = this._contractSeq.step;
            const stepType = def.steps[step];
            if (await this._sequenceSetStep(stepType, digits, step, preset)) {
                this._contractSequenceAwaitingSettlement = true;
                return true;
            }
            this._contractSeq.step = 1;
            return this._applyContractSequence(preset);
        }

        async _sequenceRecoveryStreak(digits, preset) {
            const n = SEQUENCE_PRESETS[preset].recoveryStreakLength ?? 3;
            if (digits.length < n) {
                this._contractSequenceBlocked = true;
                notify(`RECOVERY: need ${n} ticks for even/odd streak`);
                return false;
            }
            const last = digits.slice(-n).join('');
            if (lastNAllEven(digits, n)) {
                this.setNextContractType('DIGITEVEN');
                this._contractSeq._recoveryFired = true;
                notify(`RECOVERY: ${n} even digits (${last}) → DIGITEVEN`);
                return true;
            }
            if (lastNAllOdd(digits, n)) {
                this.setNextContractType('DIGITODD');
                this._contractSeq._recoveryFired = true;
                notify(`RECOVERY: ${n} odd digits (${last}) → DIGITODD`);
                return true;
            }
            this._contractSequenceBlocked = true;
            notify(`RECOVERY: waiting ${n} even or ${n} odd in a row (last: ${last || '—'})`);
            return false;
        }

        async _sequenceRecoveryBias(digits) {
            if (digits.length < 15) {
                this._contractSequenceBlocked = true;
                notify('RECOVERY: need 15 ticks');
                return false;
            }
            const { evenPct, oddPct } = evenOddPct(digits);
            if (evenPct >= 70) {
                this.setNextContractType('DIGITEVEN');
                this._contractSeq._recoveryFired = true;
                notify(`RECOVERY: EVEN ${evenPct.toFixed(1)}% → DIGITEVEN`);
                return true;
            }
            if (oddPct >= 70) {
                this.setNextContractType('DIGITODD');
                this._contractSeq._recoveryFired = true;
                notify(`RECOVERY: ODD ${oddPct.toFixed(1)}% → DIGITODD`);
                return true;
            }
            this._contractSequenceBlocked = true;
            notify(`RECOVERY: waiting ≥70% (even ${evenPct.toFixed(1)}%, odd ${oddPct.toFixed(1)}%)`);
            return false;
        }

        async _sequenceSetStep(stepType, digits, stepNo, preset) {
            switch (stepType) {
                case 'differ':
                case 'differ0': {
                    const digit = digits.length >= 15 ? coldestDigit(digits) : 0;
                    if (digits.length < 15) {
                        notify(`Step ${stepNo}: <15 ticks — DIFFER fallback digit 0`);
                    }
                    this.setNextContractType('DIGITDIFF', digit);
                    notify(`Step ${stepNo}: DIFFER → digit ${digit}`);
                    return true;
                }
                case 'differ9':
                    this.setNextContractType('DIGITDIFF', 9);
                    notify(`Step ${stepNo}: DIFFER 9`);
                    return true;
                case 'over0':
                    this.setNextContractType('DIGITOVER', 0);
                    notify(`Step ${stepNo}: OVER 0`);
                    return true;
                case 'over1':
                    this.setNextContractType('DIGITOVER', 1);
                    notify(`Step ${stepNo}: OVER 1`);
                    return true;
                case 'over2':
                    this.setNextContractType('DIGITOVER', 2);
                    notify(`Step ${stepNo}: OVER 2`);
                    return true;
                case 'under7':
                    this.setNextContractType('DIGITUNDER', 7);
                    notify(`Step ${stepNo}: UNDER 7`);
                    return true;
                case 'under8':
                    this.setNextContractType('DIGITUNDER', 8);
                    notify(`Step ${stepNo}: UNDER 8`);
                    return true;
                default:
                    return false;
            }
        }

        _contractSequenceSettlement(isWin) {
            if (!this._contractSequenceActive || !this._contractSeq) return;

            const preset = this._contractSeq.preset || 'differ_over';
            const def = SEQUENCE_PRESETS[preset];
            const state = this._contractSeq;

            this._contractSequenceAwaitingSettlement = false;
            this._contractSequenceBlocked = false;

            if (def.recoveryOnLoss) {
                if (state.inRecovery) {
                    if (state._recoveryFired && isWin) {
                        state.inRecovery = false;
                        state._recoveryFired = false;
                        state.step = 1;
                        notify(`Recovery won — resuming ${preset} at step 1`);
                        return;
                    }
                    if (state._recoveryFired && !isWin) {
                        state._recoveryFired = false;
                        notify('Recovery loss — waiting for even/odd streak again');
                        return;
                    }
                }
                if (!isWin) {
                    state.inRecovery = true;
                    const n = def.recoveryStreakLength ?? 3;
                    notify(`Loss at step ${state.step} — recovery (${n} even / ${n} odd digits)`);
                    return;
                }
            }

            const prevStep = state.step;
            state.step = prevStep >= (def.stepCount ?? 4) ? 1 : prevStep + 1;
            notify(`${preset} step ${prevStep} → ${state.step}`);
        }

        /* ------------------------------------------------------------------
         * money8gg fork hooks
         *
         * That fork shipped three "hook" blocks that are the purchase step of
         * the strategy: they watch the digits and place the order themselves
         * (their strategies have no separate Purchase block). They used to be
         * inert placeholders, so those bots loaded but never traded. Each hook
         * keeps the fork's own fields and is evaluated on every Before Purchase
         * pass, exactly like a Purchase block with a condition attached.
         * ---------------------------------------------------------------- */
        async switchMarket(symbol) {
            if (!symbol || symbol === 'disable') return;
            if (!HOOK_MARKETS.includes(symbol)) return;
            notify(`Switching market to ${symbol}`);
            await this.setMarket(symbol);
        }

        /** How many contracts the following Purchase step should place. */
        async setTradeRepeat(count) {
            this._tradeRepeat = clampInt(count, 1, 1, 50);
        }

        /** Reads and clears the repeat count set by a Multiple trades block. */
        _takeTradeRepeat() {
            const repeat = clampInt(this._tradeRepeat, 1, 1, 50);
            this._tradeRepeat = 1;
            return repeat;
        }

        async _hookBuy(contract, prediction, label) {
            this.setNextContractType(contract, prediction);
            notify(`${label}: ${contract}${prediction === undefined ? '' : ` ${prediction}`}`);
            await this.purchase(contract, prediction);
        }

        async _hookDigits(count = 15) {
            try {
                return await this.getDigitsForStrategy(count);
            } catch {
                return [];
            }
        }

        /**
         * Over/Under hook — the fork's "over_under_hook" step.
         *
         * Main entry: the configured trigger on the recent digits, then buy the
         * main contract at its prediction. `continuous` keeps entering for as
         * long as the trigger holds; `single` enters once per trigger run. A
         * loss moves the strategy into its recovery trigger when one is set.
         */
        async overUnderHook(config = {}) {
            this._activeHook = { type: 'over_under', config };
            const digits = await this._hookDigits(15);
            const recovery_configured = config.recovery_contract && config.recovery_contract !== 'OFF';

            if (this._hookInRecovery && recovery_configured) {
                const ready = triggerMet({
                    trigger: config.recovery_trigger,
                    digits,
                    value: Number(config.recovery_value),
                    count: config.recovery_consec,
                });
                if (!ready) {
                    notify('Recovery: waiting for the configured digit run');
                    return false;
                }
                await this._hookBuy(config.recovery_contract, Number(config.recovery_prediction), 'Recovery entry');
                return true;
            }

            const set = [config.main_digit_1, config.main_digit_2, config.main_digit_3]
                .filter(digit => digit !== undefined && digit !== null && digit !== '')
                .map(digit => Number(digit));
            const ready =
                config.main_trigger === 'equals_any'
                    ? triggerMet({ trigger: 'equals_any', digits, set })
                    : triggerMet({
                          trigger: config.main_trigger,
                          digits,
                          value: Number(config.main_value),
                          count: config.main_consec,
                      });

            if (!ready) {
                this._hookSignalFired = false;
                return false;
            }
            if (config.main_mode === 'single' && this._hookSignalFired) return false;

            this._hookSignalFired = true;
            await this._hookBuy(config.main_contract, Number(config.main_prediction), 'Main entry');
            return true;
        }

        /**
         * Virtual hook — the fork's "virtual_hook" step. It trades immediately
         * (retrying a limited number of times), falls back to a digit trigger on
         * the main run, and uses a third trigger while recovering from a loss.
         */
        async virtualHook(config = {}) {
            this._activeHook = { type: 'virtual', config };
            if (this._virtualRetriesLeft === 0 && this._virtualStage === 'immediate') {
                this._virtualRetriesLeft = clampInt(config.immediate_retries, 1, 0, 20);
            }

            const digits = await this._hookDigits(15);

            if (this._virtualStage === 'immediate' && this._virtualRetriesLeft > 0 && config.immediate_trigger !== 'off') {
                await this._hookBuy(
                    config.immediate_contract,
                    Number(config.immediate_prediction),
                    'Immediate entry'
                );
                return true;
            }

            const stage = this._hookInRecovery ? 'recovery' : 'main';
            const trigger = stage === 'recovery' ? config.recovery_trigger : config.main_trigger;
            const value = Number(stage === 'recovery' ? config.recovery_value : config.main_value);
            const count = stage === 'recovery' ? config.recovery_count : config.main_count;
            const contract = stage === 'recovery' ? config.recovery_contract : config.main_contract;
            const prediction = Number(stage === 'recovery' ? config.recovery_prediction : config.main_prediction);

            if (!triggerMet({ trigger, digits, value, count })) {
                notify(`${stage === 'recovery' ? 'Recovery' : 'Main'} stage: waiting for the digit trigger`);
                return false;
            }

            await this._hookBuy(contract, prediction, stage === 'recovery' ? 'Recovery entry' : 'Main entry');
            return true;
        }

        /**
         * Hedge hook — the fork's "hedge_hook" step: once the gate digit shows
         * up, buy both legs of the hedge in the same tick.
         */
        async hedgeHook(config = {}) {
            this._activeHook = { type: 'hedge', config };
            const digits = await this._hookDigits(15);

            if (
                !triggerMet({
                    trigger: config.gate_trigger,
                    digits,
                    value: Number(config.gate_value),
                    count: config.gate_count,
                })
            ) {
                notify('Hedge gate not met — waiting for the configured digit');
                return false;
            }

            notify(`Hedge gate met — buying ${config.leg_a_contract} and ${config.leg_b_contract}`);
            // Both legs are placed before either buy settles: the engine is
            // still in Before Purchase for the second call, so the pair goes out
            // together instead of one leg being dropped.
            this.setNextContractType(config.leg_a_contract, Number(config.leg_a_prediction));
            const leg_a = this.purchase(config.leg_a_contract, Number(config.leg_a_prediction));
            this.setNextContractType(config.leg_b_contract, Number(config.leg_b_prediction));
            const leg_b = this.purchase(config.leg_b_contract, Number(config.leg_b_prediction));
            await Promise.allSettled([leg_a, leg_b]);
            return true;
        }

        _hookSettlement(isWin) {
            const hook = this._activeHook;
            if (!hook) return;

            if (hook.type === 'over_under') {
                const recovery_configured =
                    hook.config.recovery_contract && hook.config.recovery_contract !== 'OFF';
                if (!isWin && recovery_configured) {
                    this._hookInRecovery = true;
                } else if (isWin) {
                    this._hookInRecovery = false;
                }
                return;
            }

            if (hook.type === 'virtual') {
                if (isWin) {
                    this._hookInRecovery = false;
                    if (this._virtualStage === 'immediate') this._virtualStage = 'main';
                    return;
                }
                if (this._virtualStage === 'immediate') {
                    this._virtualRetriesLeft -= 1;
                    if (this._virtualRetriesLeft <= 0) this._virtualStage = 'main';
                    return;
                }
                this._hookInRecovery = true;
            }
        }

        /* ------------------------------------------------------------------
         * Settlement hook (called from Total.updateTotals)
         * ---------------------------------------------------------------- */
        onStrategySettlement(isWin) {
            if (this._contractSequenceActive) this._contractSequenceSettlement(isWin);
            if (this._conceptBlockActive) this._conceptBlockSettlement(isWin);
            this._hookSettlement(isWin);
        }
    };
