/**
 * generate-newly-added-bots.js
 *
 * Generates a fresh set of Deriv Bot strategies into src/xml/free-bots/newly-added/
 * covering the requested trade types:
 *   - Rise / Fall          (CALL / PUT)
 *   - Only Ups / Only Downs (RUNHIGH / RUNLOW)
 *   - Even / Odd           (DIGITEVEN / DIGITODD)
 *   - Matches / Differs    (DIGITMATCH / DIGITDIFF)
 *
 * Every strategy is built ONLY from block types registered in this build
 * (src/external/bot-skeleton/scratch/blocks), so they load without the
 * "unsupported elements" warning.
 *
 * Usage: node scripts/generate-newly-added-bots.js
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('src/xml/free-bots/newly-added');
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let _idCounter = 0;
const id = prefix => `${prefix}_${(++_idCounter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const mkVar = (name, ids) => {
    if (!ids[name]) ids[name] = `var_${name.replace(/\W/g, '')}_${Math.random().toString(36).slice(2, 8)}`;
    return ids[name];
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ */
/* Block builders (only registered block types)                        */
/* ------------------------------------------------------------------ */

const tradeOptionsChain = ({ category, tradetype, contract_type, symbol }) => `
      <block type="trade_definition_market" id="${id('mkt')}" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="${id('tt')}" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${category}</field>
            <field name="TRADETYPE_LIST">${tradetype}</field>
            <next>
              <block type="trade_definition_contracttype" id="${id('ct')}" deletable="false" movable="false">
                <field name="TYPE_LIST">${contract_type}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="${id('ci')}" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="${id('rs')}" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="${id('re')}" deletable="false" movable="false">
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
      </block>`;

// Chain of variables_set blocks (last one closes, others wrap a <next>)
const initChain = (defs, ids) => {
    let inner = '';
    for (let i = defs.length - 1; i >= 0; i--) {
        const d = defs[i];
        const nextPart = i < defs.length - 1 ? inner : '';
        inner = `      <block type="variables_set" id="${id('set')}">
        <field name="VAR" id="${ids[d.name]}">${d.name}</field>
        <value name="VALUE">
          <block type="math_number" id="${id('num')}">
            <field name="NUM">${d.value}</field>
          </block>
        </value>
        ${nextPart ? `<next>\n${nextPart}\n        </next>` : ''}
      </block>`;
    }
    return inner;
};

const submarketBlock = ({ has_prediction, duration, stake_var, prediction_var, ids }) => {
    const pred = has_prediction
        ? `
        <value name="PREDICTION">
          <shadow type="math_number_positive" id="${id('pred')}">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="${id('get')}">
            <field name="VAR" id="${ids[prediction_var]}">${prediction_var}</field>
          </block>
        </value>`
        : '';
    return `      <block type="trade_definition_tradeoptions" id="${id('to')}">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="${has_prediction}"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="${id('dur')}">
            <field name="NUM">${duration}</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive" id="${id('amt')}">
            <field name="NUM">1</field>
          </shadow>
          <block type="variables_get" id="${id('get')}">
            <field name="VAR" id="${ids[stake_var]}">${stake_var}</field>
          </block>
        </value>${pred}
      </block>`;
};

// after_purchase: martingale mode (stake up on loss) or anti-martingale (stake up on win)
const afterPurchaseBlock = ({ mode, ids }) => {
    const { Stake, InitialStake, TakeProfit, Martingale, MartingaleLevel, lossCounter } = ids;
    if (mode === 'anti') {
        return `  <block type="after_purchase" id="${id('ap')}" x="714" y="60">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="${id('if')}">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id="${id('cmp')}">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="total_profit" id="${id('tp')}"></block>
            </value>
            <value name="B">
              <block type="variables_get" id="${id('get')}">
                <field name="VAR" id="${TakeProfit}">TakeProfit</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="notify" id="${id('ntf')}">
            <field name="NOTIFICATION_TYPE">success</field>
            <field name="NOTIFICATION_SOUND">silent</field>
            <value name="MESSAGE">
              <shadow type="text" id="${id('txt')}">
                <field name="TEXT">Target reached - stopping bot</field>
              </shadow>
            </value>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="${id('if2')}">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0">
              <block type="contract_check_result" id="${id('ck')}">
                <field name="CHECK_RESULT">win</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="${id('set')}">
                <field name="VAR" id="${Stake}">Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="${id('arith')}">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <shadow type="math_number" id="${id('num')}">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${Stake}">Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="${id('num')}">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${Martingale}">Martingale</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="math_change" id="${id('chg')}">
                    <field name="VAR" id="${lossCounter}">lossCounter</field>
                    <value name="DELTA">
                      <shadow type="math_number" id="${id('num')}">
                        <field name="NUM">1</field>
                      </shadow>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="variables_set" id="${id('set')}">
                <field name="VAR" id="${Stake}">Stake</field>
                <value name="VALUE">
                  <block type="variables_get" id="${id('get')}">
                    <field name="VAR" id="${InitialStake}">InitialStake</field>
                  </block>
                </value>
              </block>
            </statement>
            <next>
              <block type="controls_if" id="${id('if3')}">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="${id('cmp')}">
                    <field name="OP">LTE</field>
                    <value name="A">
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${lossCounter}">lossCounter</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${MartingaleLevel}">MartingaleLevel</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="trade_again" id="${id('ta')}"></block>
                </statement>
                <statement name="ELSE">
                  <block type="notify" id="${id('ntf')}">
                    <field name="NOTIFICATION_TYPE">error</field>
                    <field name="NOTIFICATION_SOUND">silent</field>
                    <value name="MESSAGE">
                      <shadow type="text" id="${id('txt')}">
                        <field name="TEXT">Max cycles reached - bot stopped</field>
                      </shadow>
                    </value>
                  </block>
                </statement>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>`;
    }
    // martingale (default): stake up on loss
    return `  <block type="after_purchase" id="${id('ap')}" x="714" y="60">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="${id('if')}">
        <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
        <value name="IF0">
          <block type="logic_compare" id="${id('cmp')}">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="total_profit" id="${id('tp')}"></block>
            </value>
            <value name="B">
              <block type="variables_get" id="${id('get')}">
                <field name="VAR" id="${TakeProfit}">TakeProfit</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="notify" id="${id('ntf')}">
            <field name="NOTIFICATION_TYPE">success</field>
            <field name="NOTIFICATION_SOUND">silent</field>
            <value name="MESSAGE">
              <shadow type="text" id="${id('txt')}">
                <field name="TEXT">Target reached - stopping bot</field>
              </shadow>
            </value>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="${id('if2')}">
            <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
            <value name="IF0">
              <block type="contract_check_result" id="${id('ck')}">
                <field name="CHECK_RESULT">win</field>
              </block>
            </value>
            <statement name="DO0">
              <block type="variables_set" id="${id('set')}">
                <field name="VAR" id="${Stake}">Stake</field>
                <value name="VALUE">
                  <block type="variables_get" id="${id('get')}">
                    <field name="VAR" id="${InitialStake}">InitialStake</field>
                  </block>
                </value>
              </block>
            </statement>
            <statement name="ELSE">
              <block type="variables_set" id="${id('set')}">
                <field name="VAR" id="${Stake}">Stake</field>
                <value name="VALUE">
                  <block type="math_arithmetic" id="${id('arith')}">
                    <field name="OP">MULTIPLY</field>
                    <value name="A">
                      <shadow type="math_number" id="${id('num')}">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${Stake}">Stake</field>
                      </block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="${id('num')}">
                        <field name="NUM">1</field>
                      </shadow>
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${Martingale}">Martingale</field>
                      </block>
                    </value>
                  </block>
                </value>
                <next>
                  <block type="math_change" id="${id('chg')}">
                    <field name="VAR" id="${lossCounter}">lossCounter</field>
                    <value name="DELTA">
                      <shadow type="math_number" id="${id('num')}">
                        <field name="NUM">1</field>
                      </shadow>
                    </value>
                  </block>
                </next>
              </block>
            </statement>
            <next>
              <block type="controls_if" id="${id('if3')}">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="logic_compare" id="${id('cmp')}">
                    <field name="OP">LTE</field>
                    <value name="A">
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${lossCounter}">lossCounter</field>
                      </block>
                    </value>
                    <value name="B">
                      <block type="variables_get" id="${id('get')}">
                        <field name="VAR" id="${MartingaleLevel}">MartingaleLevel</field>
                      </block>
                    </value>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="trade_again" id="${id('ta')}"></block>
                </statement>
                <statement name="ELSE">
                  <block type="notify" id="${id('ntf')}">
                    <field name="NOTIFICATION_TYPE">error</field>
                    <field name="NOTIFICATION_SOUND">silent</field>
                    <value name="MESSAGE">
                      <shadow type="text" id="${id('txt')}">
                        <field name="TEXT">Max recovery reached - bot stopped</field>
                      </shadow>
                    </value>
                  </block>
                </statement>
              </block>
            </next>
          </block>
        </statement>
      </block>
    </statement>
  </block>`;
};

const beforePurchaseBlock = purchase_list => `  <block type="before_purchase" id="${id('bp')}" deletable="false" x="0" y="640">
    <statement name="BEFOREPURCHASE_STACK">
      <block type="purchase" id="${id('pur')}">
        <field name="PURCHASE_LIST">${purchase_list}</field>
      </block>
    </statement>
  </block>`;

/* ------------------------------------------------------------------ */
/* Strategy assembly                                                   */
/* ------------------------------------------------------------------ */

const buildStrategy = cfg => {
    const ids = {};
    const varNames = ['Stake', 'InitialStake', 'TakeProfit', 'Martingale', 'MartingaleLevel', 'lossCounter'];
    if (cfg.has_prediction) varNames.push('Prediction');
    varNames.forEach(n => mkVar(n, ids));

    const variables = varNames.map(n => `    <variable id="${ids[n]}">${n}</variable>`).join('\n');

    const initDefs = [
        { name: 'Stake', value: cfg.initial_stake },
        { name: 'InitialStake', value: cfg.initial_stake },
        { name: 'TakeProfit', value: cfg.take_profit },
        { name: 'Martingale', value: cfg.martingale },
        { name: 'MartingaleLevel', value: cfg.levels },
        { name: 'lossCounter', value: 1 },
    ];
    if (cfg.has_prediction) initDefs.push({ name: 'Prediction', value: cfg.prediction ?? 4 });

    const xml = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
${variables}
  </variables>
  <block type="trade_definition" id="${id('td')}" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
${tradeOptionsChain(cfg)}
    </statement>
    <statement name="INITIALIZATION">
${initChain(initDefs, ids)}
    </statement>
    <statement name="SUBMARKET">
${submarketBlock({ ...cfg, ids, stake_var: 'Stake', prediction_var: 'Prediction' })}
    </statement>
  </block>
${afterPurchaseBlock({ mode: cfg.mode, ids })}
${beforePurchaseBlock(cfg.purchase_list)}
</xml>
`;
    return xml;
};

/* ------------------------------------------------------------------ */
/* Bot catalogue — 24 bots across the requested trade types            */
/* ------------------------------------------------------------------ */

const BOTS = [
    // ---- Rise / Fall (CALL / PUT) ----
    { file: 'newlyadded-Rise-Fall-Martingale', name: 'Rise Fall Martingale', category: 'callput', tradetype: 'callput', contract_type: 'both', purchase_list: 'CALL', symbol: '1HZ100V', duration: 1, initial_stake: 1, take_profit: 15, martingale: 2, levels: 6, mode: 'martingale' },
    { file: 'newlyadded-Rise-Fall-Flat', name: 'Rise Fall Flat', category: 'callput', tradetype: 'callput', contract_type: 'both', purchase_list: 'CALL', symbol: '1HZ75V', duration: 1, initial_stake: 1, take_profit: 10, martingale: 1, levels: 1, mode: 'martingale' },
    { file: 'newlyadded-Rise-Fall-Anti-Martingale', name: 'Rise Fall Anti Martingale', category: 'callput', tradetype: 'callput', contract_type: 'both', purchase_list: 'CALL', symbol: '1HZ50V', duration: 1, initial_stake: 1, take_profit: 20, martingale: 2, levels: 6, mode: 'anti' },
    { file: 'newlyadded-Rise-Only-Scalper', name: 'Rise Only Scalper', category: 'callput', tradetype: 'callput', contract_type: 'CALL', purchase_list: 'CALL', symbol: '1HZ10V', duration: 1, initial_stake: 0.5, take_profit: 8, martingale: 2, levels: 4, mode: 'martingale' },
    { file: 'newlyadded-Fall-Only-Scalper', name: 'Fall Only Scalper', category: 'callput', tradetype: 'callput', contract_type: 'PUT', purchase_list: 'PUT', symbol: '1HZ25V', duration: 1, initial_stake: 0.5, take_profit: 8, martingale: 2, levels: 4, mode: 'martingale' },
    { file: 'newlyadded-Rise-Fall-5-Tick', name: 'Rise Fall 5 Tick', category: 'callput', tradetype: 'callput', contract_type: 'both', purchase_list: 'CALL', symbol: '1HZ150V', duration: 5, initial_stake: 1, take_profit: 15, martingale: 1, levels: 1, mode: 'martingale' },

    // ---- Only Ups / Only Downs (RUNHIGH / RUNLOW) ----
    { file: 'newlyadded-Only-Ups-Bot', name: 'Only Ups Bot', category: 'runs', tradetype: 'runs', contract_type: 'both', purchase_list: 'RUNHIGH', symbol: '1HZ100V', duration: 1, initial_stake: 1, take_profit: 12, martingale: 2, levels: 5, mode: 'martingale' },
    { file: 'newlyadded-Only-Downs-Bot', name: 'Only Downs Bot', category: 'runs', tradetype: 'runs', contract_type: 'both', purchase_list: 'RUNLOW', symbol: '1HZ75V', duration: 1, initial_stake: 1, take_profit: 12, martingale: 2, levels: 5, mode: 'martingale' },
    { file: 'newlyadded-Only-Ups-Martingale', name: 'Only Ups Martingale', category: 'runs', tradetype: 'runs', contract_type: 'both', purchase_list: 'RUNHIGH', symbol: '1HZ50V', duration: 1, initial_stake: 1, take_profit: 18, martingale: 2.5, levels: 6, mode: 'martingale' },
    { file: 'newlyadded-Only-Downs-Martingale', name: 'Only Downs Martingale', category: 'runs', tradetype: 'runs', contract_type: 'both', purchase_list: 'RUNLOW', symbol: '1HZ25V', duration: 1, initial_stake: 1, take_profit: 18, martingale: 2.5, levels: 6, mode: 'martingale' },
    { file: 'newlyadded-Only-Ups-Flat', name: 'Only Ups Flat', category: 'runs', tradetype: 'runs', contract_type: 'both', purchase_list: 'RUNHIGH', symbol: '1HZ10V', duration: 2, initial_stake: 0.5, take_profit: 10, martingale: 1, levels: 1, mode: 'martingale' },
    { file: 'newlyadded-Only-Downs-Flat', name: 'Only Downs Flat', category: 'runs', tradetype: 'runs', contract_type: 'both', purchase_list: 'RUNLOW', symbol: '1HZ150V', duration: 2, initial_stake: 0.5, take_profit: 10, martingale: 1, levels: 1, mode: 'martingale' },

    // ---- Even / Odd (DIGITEVEN / DIGITODD) ----
    { file: 'newlyadded-Even-Digit-Bot', name: 'Even Digit Bot', category: 'digits', tradetype: 'evenodd', contract_type: 'both', purchase_list: 'DIGITEVEN', symbol: '1HZ100V', duration: 1, initial_stake: 1, take_profit: 12, martingale: 2, levels: 5, mode: 'martingale' },
    { file: 'newlyadded-Odd-Digit-Bot', name: 'Odd Digit Bot', category: 'digits', tradetype: 'evenodd', contract_type: 'both', purchase_list: 'DIGITODD', symbol: '1HZ75V', duration: 1, initial_stake: 1, take_profit: 12, martingale: 2, levels: 5, mode: 'martingale' },
    { file: 'newlyadded-Even-Digit-Martingale', name: 'Even Digit Martingale', category: 'digits', tradetype: 'evenodd', contract_type: 'both', purchase_list: 'DIGITEVEN', symbol: '1HZ50V', duration: 1, initial_stake: 1, take_profit: 18, martingale: 2.5, levels: 6, mode: 'martingale' },
    { file: 'newlyadded-Odd-Digit-Martingale', name: 'Odd Digit Martingale', category: 'digits', tradetype: 'evenodd', contract_type: 'both', purchase_list: 'DIGITODD', symbol: '1HZ25V', duration: 1, initial_stake: 1, take_profit: 18, martingale: 2.5, levels: 6, mode: 'martingale' },
    { file: 'newlyadded-Even-Digit-5-Tick', name: 'Even Digit 5 Tick', category: 'digits', tradetype: 'evenodd', contract_type: 'both', purchase_list: 'DIGITEVEN', symbol: '1HZ10V', duration: 5, initial_stake: 0.5, take_profit: 10, martingale: 1, levels: 1, mode: 'martingale' },
    { file: 'newlyadded-Odd-Digit-5-Tick', name: 'Odd Digit 5 Tick', category: 'digits', tradetype: 'evenodd', contract_type: 'both', purchase_list: 'DIGITODD', symbol: '1HZ150V', duration: 5, initial_stake: 0.5, take_profit: 10, martingale: 1, levels: 1, mode: 'martingale' },

    // ---- Matches / Differs (DIGITMATCH / DIGITDIFF) ----
    { file: 'newlyadded-Matches-Bot', name: 'Matches Bot', category: 'digits', tradetype: 'matchesdiffers', contract_type: 'DIGITMATCH', purchase_list: 'DIGITMATCH', symbol: '1HZ100V', duration: 1, initial_stake: 1, take_profit: 15, martingale: 2, levels: 5, mode: 'martingale', has_prediction: true, prediction: 4 },
    { file: 'newlyadded-Differs-Bot', name: 'Differs Bot', category: 'digits', tradetype: 'matchesdiffers', contract_type: 'DIGITDIFF', purchase_list: 'DIGITDIFF', symbol: '1HZ75V', duration: 1, initial_stake: 1, take_profit: 15, martingale: 2, levels: 5, mode: 'martingale', has_prediction: true, prediction: 4 },
    { file: 'newlyadded-Matches-Martingale', name: 'Matches Martingale', category: 'digits', tradetype: 'matchesdiffers', contract_type: 'DIGITMATCH', purchase_list: 'DIGITMATCH', symbol: '1HZ50V', duration: 1, initial_stake: 1, take_profit: 20, martingale: 2.5, levels: 6, mode: 'martingale', has_prediction: true, prediction: 5 },
    { file: 'newlyadded-Differs-Martingale', name: 'Differs Martingale', category: 'digits', tradetype: 'matchesdiffers', contract_type: 'DIGITDIFF', purchase_list: 'DIGITDIFF', symbol: '1HZ25V', duration: 1, initial_stake: 1, take_profit: 20, martingale: 2.5, levels: 6, mode: 'martingale', has_prediction: true, prediction: 5 },
    { file: 'newlyadded-Matches-5-Tick', name: 'Matches 5 Tick', category: 'digits', tradetype: 'matchesdiffers', contract_type: 'DIGITMATCH', purchase_list: 'DIGITMATCH', symbol: '1HZ10V', duration: 5, initial_stake: 0.5, take_profit: 10, martingale: 1, levels: 1, mode: 'martingale', has_prediction: true, prediction: 4 },
    { file: 'newlyadded-Differs-5-Tick', name: 'Differs 5 Tick', category: 'digits', tradetype: 'matchesdiffers', contract_type: 'DIGITDIFF', purchase_list: 'DIGITDIFF', symbol: '1HZ150V', duration: 5, initial_stake: 0.5, take_profit: 10, martingale: 1, levels: 1, mode: 'martingale', has_prediction: true, prediction: 4 },
];

for (const cfg of BOTS) {
    const xml = buildStrategy(cfg);
    const filePath = path.join(OUT_DIR, `${cfg.file}-xml.xml`);
    fs.writeFileSync(filePath, xml);
    console.log(`Wrote ${path.relative(process.cwd(), filePath)}`);
}
console.log(`\nDone: ${BOTS.length} strategies in ${path.relative(process.cwd(), OUT_DIR)}`);
