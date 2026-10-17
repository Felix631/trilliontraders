const getStrategyInterface = tradeEngine => {
    return {
        applyConceptBlock: (...args) => tradeEngine.applyConceptBlock(...args),
        applyContractSequenceDiff0Over12Streak2: (...args) => tradeEngine.applyContractSequenceDiff0Over12Streak2(...args),
        rotateToNextVolatilityMarket: (...args) => tradeEngine.rotateToNextVolatilityMarket(...args),
        setActiveSymbol: (...args) => tradeEngine.setActiveSymbol(...args),
        setContractType: (...args) => tradeEngine.setContractType(...args),
        apolloPurchase: (...args) => tradeEngine.apolloPurchase(...args),
        // The money8gg fork's purchase hooks and market switch.
        overUnderHook: (...args) => tradeEngine.overUnderHook(...args),
        virtualHook: (...args) => tradeEngine.virtualHook(...args),
        hedgeHook: (...args) => tradeEngine.hedgeHook(...args),
        switchMarket: (...args) => tradeEngine.switchMarket(...args),
        setTradeRepeat: (...args) => tradeEngine.setTradeRepeat(...args),
    };
};

export default getStrategyInterface;
