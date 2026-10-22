/**
 * Builds a ready-to-run Deriv Bot (DBot/Blockly) XML skeleton for an Analysis
 * Tool signal, following the same block structure as the community bot XMLs
 * already shipped in this repo (trade_definition → market → trade type →
 * contract type → candle interval → restart flags → initialization).
 */

export interface SignalBotXmlParams {
    symbol: string;
    /** Deriv contract code: DIGITEVEN, DIGITODD, DIGITOVER, DIGITUNDER, DIGITMATCH */
    contract_type: string;
    prediction?: number;
    stake?: number;
}

const TRADE_TYPE_OF: Record<string, string> = {
    DIGITEVEN: 'evenodd',
    DIGITODD: 'evenodd',
    DIGITOVER: 'overunder',
    DIGITUNDER: 'overunder',
    DIGITMATCH: 'matchdiff',
};

const SIDE_OF: Record<string, string> = {
    DIGITEVEN: 'even',
    DIGITODD: 'odd',
    DIGITOVER: 'over',
    DIGITUNDER: 'under',
    DIGITMATCH: 'match',
};

export const signalBotXml = ({ symbol, contract_type, prediction, stake = 1 }: SignalBotXmlParams): string => {
    const trade_type = TRADE_TYPE_OF[contract_type] || 'overunder';
    const side = SIDE_OF[contract_type] || 'both';
    return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="tt-stake">Stake</variable>
    <variable id="tt-martingale">Martingale_stake</variable>
    <variable id="tt-martingale-size">Martingale_size</variable>
    <variable id="tt-stop-loss">Stop_loss</variable>
    <variable id="tt-take-profit">Take_profit</variable>
  </variables>
  <block type="trade_definition" id="tt-trade-definition" deletable="false" x="0" y="110">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="tt-market" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="tt-tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">digits</field>
            <field name="TRADETYPE_LIST">${trade_type}</field>
            <next>
              <block type="trade_definition_contracttype" id="tt-contracttype" deletable="false" movable="false">
                <field name="TYPE_LIST">${side}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="tt-candleinterval" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="tt-restartbuysell" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="tt-restartonerror" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION">
      <block type="variables_set" id="tt-init-stake">
        <field name="VAR" id="tt-stake">Stake</field>
        <value name="VALUE">
          <block type="math_number" id="tt-init-stake-num">
            <field name="NUM">${stake}</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="tt-init-martingale">
            <field name="VAR" id="tt-martingale">Martingale_stake</field>
            <value name="VALUE">
              <block type="variables_get" id="tt-init-martingale-get">
                <field name="VAR" id="tt-stake">Stake</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="tt-init-martingale-size">
                <field name="VAR" id="tt-martingale-size">Martingale_size</field>
                <value name="VALUE">
                  <block type="math_number" id="tt-init-martingale-size-num">
                    <field name="NUM">2</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="tt-init-stop-loss">
                    <field name="VAR" id="tt-stop-loss">Stop_loss</field>
                    <value name="VALUE">
                      <block type="math_number" id="tt-init-stop-loss-num">
                        <field name="NUM">${Math.max(stake * 20, 20)}</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="tt-init-take-profit">
                        <field name="VAR" id="tt-take-profit">Take_profit</field>
                        <value name="VALUE">
                          <block type="math_number" id="tt-init-take-profit-num">
                            <field name="NUM">${Math.max(stake * 10, 10)}</field>
                          </block>
                        </value>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
  </block>${prediction !== undefined ? `\n  <!-- Signal target: ${contract_type} ${prediction} -->` : ''}
</xml>
`;
};
