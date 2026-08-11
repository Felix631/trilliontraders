const getStrategyInterface = tradeEngine => {
    return {
        applyConceptBlock: (...args) => tradeEngine.applyConceptBlock(...args),
        applyContractSequenceDiff0Over12Streak2: (...args) => tradeEngine.applyContractSequenceDiff0Over12Streak2(...args),
        rotateToNextVolatilityMarket: (...args) => tradeEngine.rotateToNextVolatilityMarket(...args),
        setActiveSymbol: (...args) => tradeEngine.setActiveSymbol(...args),
        setContractType: (...args) => tradeEngine.setContractType(...args),
        apolloPurchase: (...args) => tradeEngine.apolloPurchase(...args),
    };
};

export default getStrategyInterface;
