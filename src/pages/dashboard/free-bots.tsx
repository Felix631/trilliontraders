// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { FREE_BOTS, FREE_BOT_CREATORS } from '@/constants/free-bots-config';
import './free-bots.scss';

const ALL_CREATORS = 'All';

const FreeBots = observer(() => {
    const { free_bots } = useStore();
    const { is_loading, loading_bot_id, loadFreeBot } = free_bots;
    const [search_value, setSearchValue] = React.useState('');
    const [selected_creator, setSelectedCreator] = React.useState(ALL_CREATORS);

    const filtered_bots = React.useMemo(() => {
        const query = search_value.trim().toLowerCase();
        return FREE_BOTS.filter(bot => {
            const matches_creator = selected_creator === ALL_CREATORS || bot.creator === selected_creator;
            const matches_search = !query || `${bot.name} ${bot.creator}`.toLowerCase().includes(query);
            return matches_creator && matches_search;
        });
    }, [search_value, selected_creator]);

    return (
        <div className='free-bots'>
            <div className='free-bots__header'>
                <div className='free-bots__heading'>
                    <Text as='h2' color='prominent' size='sm' lineHeight='xxl' weight='bold' className='free-bots__title'>
                        {localize('Free Bots Library')}
                    </Text>
                    <Text as='p' color='prominent' lineHeight='s' size='xs' className='free-bots__subtitle'>
                        {localize('Browse {{ count }} ready-to-run community strategies and load one straight into the Bot Builder.', {
                            count: FREE_BOTS.length,
                        })}
                    </Text>
                </div>
                <div className='free-bots__search'>
                    <input
                        type='text'
                        className='free-bots__search-input'
                        placeholder={localize('Search bots…')}
                        value={search_value}
                        onChange={e => setSearchValue(e.target.value)}
                        data-testid='dt_free-bots-search'
                    />
                </div>
                <div className='free-bots__filters'>
                    <button
                        type='button'
                        className={classNames('free-bots__chip', {
                            'free-bots__chip--active': selected_creator === ALL_CREATORS,
                        })}
                        onClick={() => setSelectedCreator(ALL_CREATORS)}
                    >
                        {localize('All')} ({FREE_BOTS.length})
                    </button>
                    {FREE_BOT_CREATORS.map(creator => (
                        <button
                            key={creator.id}
                            type='button'
                            className={classNames('free-bots__chip', {
                                'free-bots__chip--active': selected_creator === creator.id,
                            })}
                            onClick={() => setSelectedCreator(creator.id)}
                        >
                            {creator.label} ({creator.count})
                        </button>
                    ))}
                </div>
            </div>
            <div className='free-bots__body'>
                <div className='free-bots__grid'>
                    {filtered_bots.map(bot => {
                        const is_bot_loading = loading_bot_id === bot.id;
                        return (
                            <div
                                key={bot.id}
                                className={classNames('free-bots__card', {
                                    'free-bots__card--loading': is_bot_loading,
                                })}
                            >
                                <div className='free-bots__card-creator'>{bot.creator}</div>
                                <Text
                                    as='p'
                                    color='prominent'
                                    size='xs'
                                    lineHeight='xl'
                                    weight='bold'
                                    className='free-bots__card-name'
                                >
                                    {bot.name}
                                </Text>
                                <Button
                                    text={is_bot_loading ? localize('Loading') : localize('Use this bot')}
                                    onClick={() => loadFreeBot(bot)}
                                    primary
                                    small
                                    has_effect
                                    is_loading={is_bot_loading}
                                    is_disabled={is_loading}
                                    className='free-bots__card-button'
                                />
                            </div>
                        );
                    })}
                </div>
                {!filtered_bots.length && (
                    <div className='free-bots__empty'>
                        <Text as='p' color='disabled' size='xs' align='center'>
                            {localize('No bots match your search. Try a different keyword or creator.')}
                        </Text>
                    </div>
                )}
            </div>
        </div>
    );
});

export default FreeBots;
