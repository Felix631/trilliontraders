// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { DBOT_TABS } from '@/constants/bot-contents';
import { FREE_BOTS, FREE_BOT_CREATORS } from '@/constants/free-bots-config';
import './bot-store.scss';

const ALL_CREATORS = 'All';
const STARRED_FILTER = '__starred__';
// The library holds ~2,000 strategies; rendering every tile at once would stall
// the tab, so the shelf pages in 60 at a time.
const PAGE_SIZE = 60;

/** Filled / hollow star marking a bot the user does not want to lose track of. */
const StarIcon = ({ filled }: { filled: boolean }) => (
    <svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' focusable='false'>
        <path
            d='M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45 6.19 20.5 7.3 14.03 2.6 9.45l6.5-.95L12 2.6z'
            fill={filled ? 'currentColor' : 'none'}
            stroke='currentColor'
            strokeWidth='1.6'
            strokeLinejoin='round'
        />
    </svg>
);

/**
 * Bot Store — the community strategy shelf, as its own tab.
 *
 * Every entry is a ready-to-run strategy XML that imports straight into the
 * Bot Builder through the same sequence the Load modal uses for a file from
 * local storage (see FreeBotsStore.loadBotXml).
 */
const BotStore = observer(() => {
    const { free_bots, dashboard } = useStore();
    const { is_loading, loading_bot_id, loadFreeBot, user_bots, loadUserBot, removeUserBot } = free_bots;
    const favorite_bot_ids = free_bots.favorite_bot_ids ?? [];
    const { toggleFavorite } = free_bots;
    const my_bots = user_bots ?? [];
    const [search_value, setSearchValue] = React.useState('');
    const [selected_creator, setSelectedCreator] = React.useState(ALL_CREATORS);
    const [visible_count, setVisibleCount] = React.useState(PAGE_SIZE);

    const is_favorite = (bot_id: string) => favorite_bot_ids.includes(bot_id);

    // Starred bots float to the top of whatever is on screen — the full shelf or
    // a single creator's folder — without disturbing the order of the rest.
    const filtered_bots = React.useMemo(() => {
        const query = search_value.trim().toLowerCase();
        const matches = FREE_BOTS.filter(bot => {
            const matches_creator =
                selected_creator === ALL_CREATORS ||
                (selected_creator === STARRED_FILTER ? is_favorite(bot.id) : bot.creator === selected_creator);
            const matches_search = !query || `${bot.name} ${bot.creator}`.toLowerCase().includes(query);
            return matches_creator && matches_search;
        });
        return [...matches].sort((a, b) => Number(is_favorite(b.id)) - Number(is_favorite(a.id)));
    }, [search_value, selected_creator, favorite_bot_ids]);

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

            {my_bots.length > 0 && (
                <section className='bot-store__mine'>
                    <div className='bot-store__mine-head'>
                        <h3 className='bot-store__mine-title'>
                            {localize('My bots ({{count}})', { count: String(my_bots.length) })}
                        </h3>
                        <Button
                            tertiary
                            small
                            has_effect
                            text={localize('Import more')}
                            onClick={() => dashboard.setActiveTab(DBOT_TABS.BOT_IMPORTER)}
                        />
                    </div>
                    <div className='bot-store__grid'>
                        {my_bots.map(bot => {
                            const is_bot_loading = loading_bot_id === bot.id;
                            return (
                                <article
                                    key={bot.id}
                                    className={classNames('bot-store__tile', {
                                        'bot-store__tile--loading': is_bot_loading,
                                    })}
                                >
                                    <div className='bot-store__tile-top'>
                                        <span className='bot-store__tile-creator bot-store__tile-creator--mine'>
                                            {localize('Yours')}
                                        </span>
                                        <span className='bot-store__tile-price'>{localize('IMPORTED')}</span>
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
                                        <button
                                            type='button'
                                            className='bot-store__tile-remove'
                                            onClick={() => removeUserBot(bot.id)}
                                        >
                                            {localize('Remove')}
                                        </button>
                                        <Button
                                            text={is_bot_loading ? localize('Loading') : localize('Load Bot')}
                                            onClick={() => loadUserBot(bot)}
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
                </section>
            )}

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
                    <button
                        type='button'
                        className={classNames('bot-store__chip', 'bot-store__chip--starred', {
                            'bot-store__chip--active': selected_creator === STARRED_FILTER,
                        })}
                        onClick={() => setSelectedCreator(STARRED_FILTER)}
                        data-testid='dt_free-bots-starred-filter'
                    >
                        <StarIcon filled />
                        {localize('Starred')} ({favorite_bot_ids.length})
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
                                    <div className='bot-store__tile-actions'>
                                        <span className='bot-store__tile-price'>{localize('FREE')}</span>
                                        <button
                                            type='button'
                                            className={classNames('bot-store__star', {
                                                'bot-store__star--on': is_favorite(bot.id),
                                            })}
                                            aria-pressed={is_favorite(bot.id)}
                                            title={
                                                is_favorite(bot.id)
                                                    ? localize('Remove from starred')
                                                    : localize('Star this bot')
                                            }
                                            onClick={() => toggleFavorite(bot.id)}
                                            data-testid={`dt_free-bots-star-${bot.id}`}
                                        >
                                            <StarIcon filled={is_favorite(bot.id)} />
                                        </button>
                                    </div>
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
                            {selected_creator === STARRED_FILTER && !search_value.trim()
                                ? localize('No starred bots yet — tap the star on any bot to pin it here.')
                                : localize('No bots match your search. Try a different keyword or creator.')}
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
