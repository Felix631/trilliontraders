import { localize } from '@deriv-com/translations';
import filesaver from 'file-saver';
import { getContractTypeOptions as getContractTypeOptionsFromCommon } from '../../../components/shared/utils/common-data';
import { config } from '../constants/config';

export const saveAs = ({ data, filename, type }) => {
    const blob = new Blob([data], { type });
    filesaver.saveAs(blob, filename);
};

/**
 * Every contract type a Purchase-list dropdown can hold, in the order the app
 * shows them. A dropdown only keeps a value that is in its option list, so a
 * strategy saved with `DIGITOVER` comes back blank when the list is empty —
 * which is what happened on load, because the option list is normally filled
 * in from the trade definition by a change event that does not fire while the
 * workspace is being replaced. Seeding the list means the saved setting always
 * resolves and the menu is never empty in the Bot Builder.
 */
export const PURCHASE_LIST_FALLBACK_OPTIONS = [
    [localize('Rise'), 'CALL'],
    [localize('Fall'), 'PUT'],
    [localize('Higher'), 'RUNHIGH'],
    [localize('Lower'), 'RUNLOW'],
    [localize('No Touch'), 'NOTOUCH'],
    [localize('One Touch'), 'ONETOUCH'],
    [localize('Even'), 'DIGITEVEN'],
    [localize('Odd'), 'DIGITODD'],
    [localize('Over'), 'DIGITOVER'],
    [localize('Under'), 'DIGITUNDER'],
    [localize('Matches'), 'DIGITMATCH'],
    [localize('Differs'), 'DIGITDIFF'],
];

/** The same list with the empty placeholder option first. */
export const getPurchaseListOptions = () => [['', ''], ...PURCHASE_LIST_FALLBACK_OPTIONS];

export const getContractTypeOptions = (contract_type, trade_type) => {
    // First try to get from config
    if (trade_type && trade_type !== 'na' && trade_type !== '') {
        const trade_types = config().opposites[trade_type.toUpperCase()];

        if (trade_types) {
            const contract_options = trade_types.map(type => Object.entries(type)[0].reverse());

            // When user selected a specific contract, only return the contract type they selected.
            if (contract_type !== 'both') {
                const filtered_options = contract_options.filter(option => option[1] === contract_type);
                return filtered_options;
            }
            return contract_options;
        }
    }

    // Fallback to common data
    return getContractTypeOptionsFromCommon(contract_type, trade_type);
};
