const getStrategyInterface = tradeEngine => {
    return {
        applyConceptBlock: (...args) => tradeEngine.applyConceptBlock(...args),
        applyContractSequenceDiff0Over12Streak2: (...args) => tradeEngine.applyContractSequenceDiff0Over12Streak2(...args),
        rotateToNextVolatilityMarket: (...args) => tradeEngine.rotateToNextVolatilityMarket(...args),
    };
};

export default getStrategyInterface;
