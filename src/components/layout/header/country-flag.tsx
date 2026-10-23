import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useApiBase } from '@/hooks/useApiBase';
import {
    cacheCountryCode,
    fetchClientCountryCode,
    getCountryEmoji,
    getCountryName,
    normalizeCountryCode,
    readCachedCountryCode,
} from '@/utils/client-country';

/**
 * The signed-in client's country, as a flag chip in the top-right header.
 *
 * The code is cached so the flag is there on the first paint after a reload,
 * then refreshed from the API (and on every account switch, in case the two
 * accounts sit in different countries).
 */
const CountryFlag = observer(() => {
    const { isAuthorized, activeLoginid } = useApiBase();
    const [country_code, setCountryCode] = useState(readCachedCountryCode);
    const [is_image_broken, setIsImageBroken] = useState(false);

    useEffect(() => {
        setIsImageBroken(false);
    }, [country_code]);

    useEffect(() => {
        if (!isAuthorized || !activeLoginid) return;

        let cancelled = false;
        const load = async () => {
            const code = await fetchClientCountryCode(api_base.api);
            if (cancelled || !code) return;
            cacheCountryCode(code);
            setCountryCode(code);
        };
        load();

        return () => {
            cancelled = true;
        };
    }, [isAuthorized, activeLoginid]);

    const code = normalizeCountryCode(country_code);
    if (!code) return null;

    const country_name = getCountryName(code);

    return (
        <span className='country-flag' title={country_name} aria-label={country_name} data-testid='dt_country_flag'>
            {is_image_broken ? (
                <span className='country-flag__emoji' aria-hidden='true'>
                    {getCountryEmoji(code)}
                </span>
            ) : (
                <img
                    className='country-flag__image'
                    src={`https://flagcdn.com/w40/${code}.png`}
                    srcSet={`https://flagcdn.com/w80/${code}.png 2x`}
                    alt=''
                    width='20'
                    height='15'
                    loading='lazy'
                    onError={() => setIsImageBroken(true)}
                />
            )}
            <span className='country-flag__code'>{code.toUpperCase()}</span>
        </span>
    );
});

export default CountryFlag;
