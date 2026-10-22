// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { FREE_BOTS, FREE_BOT_CREATORS } from '@/constants/free-bots-config';
import './bot-store.scss';

const ALL_CREATORS = 'All';
// The library holds ~2,000 strategies; rendering every tile at once would stall
// the tab, so the shelf pages in 60 at a time.
const PAGE_SIZE = 60;

/**
 * Bot Store — the community strategy shelf, as its own tab.
 *
 * Every entry is a ready-to-run strategy XML that imports straight into the
 * Bot Builder through the same sequence the Load modal uses for a file from
 * local storage (see FreeBotsStore.loadBotXml).
 */
const BotStore = observer(() => {
    const { free_bots } = useStore();
    const { is_loading, loading_bot_id, loadFreeBot } = free_bots;
    const [search_value, setSearchValue] = React.useState('');
    const [selected_creator, setSelectedCreator] = React.useState(ALL_CREATORS);
    const [visible_count, setVisibleCount] = React.useState(PAGE_SIZE);

    const filtered_bots = React.useMemo(() => {
        const query = search_value.trim().toLowerCase();
        return FREE_BOTS.filter(bot => {
            const matches_creator = selected_creator === ALL_CREATORS || bot.creator === selected_creator;
            const matches_search = !query || `${bot.name} ${bot.creator}`.toLowerCase().includes(query);
            return matches_creator && matches_search;
        });
    }, [search_value, selected_creator]);

    // A new query or creator restarts the shelf from the first page.
    React.useEffect(() => setVisibleCount(PAGE_SIZE), [search_value, selected_creator]);

    const visible_bots = filtered_bots.slice(0, visible_count);

    return (
        <div className='bot-store'>
            <header className='bot-store__hero'>
                <div className='bot-store__hero-text'>
                    <span className='bot-store__kicker'>{localize('Community shelf')}</span>
                    <Text as='h2' color='prominent' size='sm' lineHeight='xxl' weight='bold' className='bot-store__title'>
                        {localize('Bot Store')}
                    </Text>
                    <Text as='p' color='prominent' lineHeight='s' size='xs' className='bot-store__subtitle'>
                        {localize('{{count}} ready-to-run strategies from {{creators}} creators — load one straight into the Bot Builder.', {
                            count: FREE_BOTS.length,
                            creators: FREE_BOT_CREATORS.length,
                        })}
                    </Text>
                </div>
                <div className='bot-store__hero-stats'>
                    <div className='bot-store__stat'>
                        <strong>{FREE_BOTS.length.toLocaleString()}</strong>
                        <span>{localize('bots')}</span>
                    </div>
                    <div className='bot-store__stat'>
                        <strong>{FREE_BOT_CREATORS.length}</strong>
                        <span>{localize('creators')}</span>
                    </div>
                    <div className='bot-store__stat bot-store__stat--free'>
                        <strong>{localize('FREE')}</strong>
                        <span>{localize('no sign-up')}</span>
                    </div>
                </div>
            </header>

            <div className='bot-store__toolbar'>
                <div className='bot-store__search'>
                    <input
                        type='text'
                        className='bot-store__search-input'
                        placeholder={localize('Search the bot library…')}
                        value={search_value}
                        onChange={e => setSearchValue(e.target.value)}
                        data-testid='dt_free-bots-search'
                    />
                </div>
                <div className='bot-store__filters'>
                    <button
                        type='button'
                        className={classNames('bot-store__chip', {
                            'bot-store__chip--active': selected_creator === ALL_CREATORS,
                        })}
                        onClick={() => setSelectedCreator(ALL_CREATORS)}
                    >
                        {localize('All Bots')} ({FREE_BOTS.length})
                    </button>
                    {FREE_BOT_CREATORS.map(creator => (
                        <button
                            key={creator.id}
                            type='button'
                            className={classNames('bot-store__chip', {
                                'bot-store__chip--active': selected_creator === creator.id,
                            })}
                            onClick={() => setSelectedCreator(creator.id)}
                        >
                            {creator.label} ({creator.count})
                        </button>
                    ))}
                </div>
            </div>

            <div className='bot-store__body'>
                <div className='bot-store__grid'>
                    {visible_bots.map(bot => {
                        const is_bot_loading = loading_bot_id === bot.id;
                        return (
                            <article
                                key={bot.id}
                                className={classNames('bot-store__tile', {
                                    'bot-store__tile--loading': is_bot_loading,
                                })}
                            >
                                <div className='bot-store__tile-top'>
                                    <span className='bot-store__tile-creator'>{bot.creator}</span>
                                    <span className='bot-store__tile-price'>{localize('FREE')}</span>
                                </div>
                                <Text
                                    as='p'
                                    color='prominent'
                                    size='xs'
                                    lineHeight='xl'
                                    weight='bold'
                                    className='bot-store__tile-name'
                                >
                                    {bot.name}
                                </Text>
                                <div className='bot-store__tile-foot'>
                                    <span className='bot-store__tile-meta'>
                                        {localize('Ready-made strategy · loads into Bot Builder')}
                                    </span>
                                    <Button
                                        text={is_bot_loading ? localize('Loading') : localize('Load Bot')}
                                        onClick={() => loadFreeBot(bot)}
                                        primary
                                        small
                                        has_effect
                                        is_loading={is_bot_loading}
                                        is_disabled={is_loading}
                                        className='bot-store__tile-button'
                                    />
                                </div>
                            </article>
                        );
                    })}
                </div>
                {!filtered_bots.length && (
                    <div className='bot-store__empty'>
                        <Text as='p' color='disabled' size='xs' align='center'>
                            {localize('No bots match your search. Try a different keyword or creator.')}
                        </Text>
                    </div>
                )}
                {filtered_bots.length > visible_count && (
                    <div className='bot-store__more'>
                        <Button
                            text={localize('Show {{n}} more of {{total}}', {
                                n: String(Math.min(PAGE_SIZE, filtered_bots.length - visible_count)),
                                total: String(filtered_bots.length),
                            })}
                            onClick={() => setVisibleCount(count => count + PAGE_SIZE)}
                            secondary
                            has_effect
                        />
                    </div>
                )}
            </div>
        </div>
    );
});

export default BotStore;
