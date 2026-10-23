import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Button from '@/components/shared_ui/button';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import {
    MAX_BOTS_PER_IMPORT,
    fetchSiteBots,
    validateBotXml,
    type TImportedBot,
} from '@/utils/bot-xml-import';
import { localize } from '@deriv-com/translations';
import type { TUserBot } from '@/stores/free-bots-store';
import './bot-importer.scss';

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Bot Importer — the shelf's intake.
 *
 * Two ways in: paste the address of a bot-library site (we read the page, find
 * the strategy files on it and download them), or drop/choose bot files from
 * the computer. Everything goes through the same XML validation and lands in
 * "My bots" in the Bot Store, where it can be loaded into the Bot Builder.
 */
const BotImporter = observer(() => {
    const { free_bots, dashboard } = useStore();
    const { user_bots, addUserBots, removeUserBot, loadUserBot, loading_bot_id, is_loading } = free_bots as any;

    const [address, setAddress] = React.useState('');
    const [is_fetching, setIsFetching] = React.useState(false);
    const [progress, setProgress] = React.useState('');
    const [pending, setPending] = React.useState<TImportedBot[]>([]);
    const [selected_ids, setSelectedIds] = React.useState<string[]>([]);
    const [errors, setErrors] = React.useState<string[]>([]);
    const [notice, setNotice] = React.useState('');
    const [is_dragging, setIsDragging] = React.useState(false);
    const file_input_ref = React.useRef<HTMLInputElement>(null);

    const apply_import_result = React.useCallback(
        async (entries: { name: string; xml: string }[]) => {
            if (!entries.length) return;
            const result = await addUserBots(entries);
            setErrors(result.errors ?? []);
            if (result.added) {
                setNotice(
                    result.added === 1
                        ? localize('Bot added to your shelf.')
                        : localize('{{count}} bots added to your shelf.', { count: String(result.added) })
                );
            } else if (result.skipped && !result.errors?.length) {
                setNotice(localize('Those bots are already on your shelf.'));
            } else {
                setNotice('');
            }
        },
        [addUserBots]
    );

    const handle_fetch = async (event: React.FormEvent) => {
        event.preventDefault();
        if (is_fetching || !address.trim()) return;

        setIsFetching(true);
        setErrors([]);
        setNotice('');
        setPending([]);
        setSelectedIds([]);
        setProgress(localize('Opening the link…'));

        try {
            const { bots, errors: fetch_errors } = await fetchSiteBots(address, message => setProgress(message));
            setPending(bots);
            setSelectedIds(bots.map(bot => bot.id));
            setErrors(fetch_errors);
            if (bots.length) {
                setNotice(
                    bots.length === 1
                        ? localize('Found 1 bot. Choose what to keep.')
                        : localize('Found {{count}} bots. Choose what to keep.', { count: String(bots.length) })
                );
            }
        } catch (error) {
            setErrors([describeError(error)]);
        } finally {
            setIsFetching(false);
            setProgress('');
        }
    };

    const read_files = async (files: FileList | File[]) => {
        const list = Array.from(files).filter(file => /\.xml$/i.test(file.name) || file.type.includes('xml'));
        if (!list.length) {
            setErrors([localize('Choose bot files ending in .xml.')]);
            return;
        }

        const entries: { name: string; xml: string }[] = [];
        const read_errors: string[] = [];

        for (const file of list) {
            try {
                const text = await file.text();
                entries.push({ name: file.name.replace(/\.xml$/i, ''), xml: validateBotXml(text) });
            } catch (error) {
                read_errors.push(`${file.name}: ${describeError(error)}`);
            }
        }

        setErrors(read_errors);
        await apply_import_result(entries);
    };

    const handle_file_input = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files?.length) await read_files(event.target.files);
        event.target.value = '';
    };

    const handle_drop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        if (event.dataTransfer?.files?.length) await read_files(event.dataTransfer.files);
    };

    const toggle_pending = (id: string) => {
        setSelectedIds(ids => (ids.includes(id) ? ids.filter(selected => selected !== id) : [...ids, id]));
    };

    const handle_add_selected = async () => {
        const entries = pending.filter(bot => selected_ids.includes(bot.id));
        await apply_import_result(entries.map(bot => ({ name: bot.name, xml: bot.xml })));
        const added_names = new Set(entries.map(bot => bot.name));
        setPending(bots => bots.filter(bot => !added_names.has(bot.name)));
        setSelectedIds([]);
    };

    const open_bot_store = () => dashboard.setActiveTab(DBOT_TABS.BOT_STORE);

    const library: TUserBot[] = user_bots ?? [];

    return (
        <div className='bot-importer'>
            <header className='bot-importer__hero'>
                <div className='bot-importer__hero-text'>
                    <span className='bot-importer__kicker'>{localize('Bring your own bots')}</span>
                    <Text as='h2' color='prominent' size='sm' lineHeight='xxl' weight='bold' className='bot-importer__title'>
                        {localize('Bot Importer')}
                    </Text>
                    <Text as='p' color='prominent' lineHeight='s' size='xs' className='bot-importer__subtitle'>
                        {localize(
                            'Paste a bot-library link or drop bot files here. Every strategy is checked, then added to My bots in the Bot Store where you can load it into the Bot Builder.'
                        )}
                    </Text>
                </div>
                <div className='bot-importer__hero-stats'>
                    <div className='bot-importer__stat'>
                        <strong>{library.length}</strong>
                        <span>{localize('my bots')}</span>
                    </div>
                    <div className='bot-importer__stat bot-importer__stat--accent'>
                        <strong>{MAX_BOTS_PER_IMPORT}</strong>
                        <span>{localize('per import')}</span>
                    </div>
                </div>
            </header>

            <div className='bot-importer__grid'>
                <section className='bot-importer__card'>
                    <div className='bot-importer__card-head'>
                        <h3>{localize('From a site link')}</h3>
                        <p>{localize('The page that lists the bots works best — for example a bot store or library page.')}</p>
                    </div>
                    <form className='bot-importer__form' onSubmit={handle_fetch}>
                        <input
                            type='url'
                            className='bot-importer__input'
                            placeholder='https://example.com/bots'
                            value={address}
                            onChange={event => setAddress(event.target.value)}
                            disabled={is_fetching}
                            data-testid='dt_bot-importer-url'
                        />
                        <Button
                            type='submit'
                            primary
                            has_effect
                            is_loading={is_fetching}
                            is_disabled={is_fetching || !address.trim()}
                            text={localize('Fetch bots')}
                            className='bot-importer__submit'
                        />
                    </form>
                    {is_fetching && progress && <p className='bot-importer__progress'>{progress}</p>}
                </section>

                <section className='bot-importer__card'>
                    <div className='bot-importer__card-head'>
                        <h3>{localize('Upload bot files')}</h3>
                        <p>{localize('Drag a bot file into the box, or choose it from your computer.')}</p>
                    </div>
                    <div
                        className={classNames('bot-importer__dropzone', {
                            'bot-importer__dropzone--active': is_dragging,
                        })}
                        onDragOver={event => {
                            event.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handle_drop}
                        onClick={() => file_input_ref.current?.click()}
                        onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                file_input_ref.current?.click();
                            }
                        }}
                        role='button'
                        tabIndex={0}
                        data-testid='dt_bot-importer-dropzone'
                    >
                        <svg width='30' height='30' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
                            <path
                                d='M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3'
                                stroke='currentColor'
                                strokeWidth='1.7'
                                strokeLinecap='round'
                                strokeLinejoin='round'
                            />
                        </svg>
                        <strong>{localize('Drop bot files here')}</strong>
                        <span>{localize('or click to browse — .xml only')}</span>
                        <input
                            ref={file_input_ref}
                            type='file'
                            accept='.xml,application/xml,text/xml'
                            multiple
                            hidden
                            onChange={handle_file_input}
                            data-testid='dt_bot-importer-input'
                        />
                    </div>
                </section>
            </div>

            {notice && <p className='bot-importer__notice'>{notice}</p>}

            {errors.length > 0 && (
                <div className='bot-importer__errors' role='alert'>
                    {errors.slice(0, 6).map(error => (
                        <p key={error}>{error}</p>
                    ))}
                </div>
            )}

            {pending.length > 0 && (
                <section className='bot-importer__findings'>
                    <div className='bot-importer__findings-head'>
                        <h3>{localize('Found on that page')}</h3>
                        <div className='bot-importer__findings-actions'>
                            <Button
                                tertiary
                                has_effect
                                small
                                text={localize('Select all')}
                                onClick={() => setSelectedIds(pending.map(bot => bot.id))}
                            />
                            <Button
                                primary
                                has_effect
                                small
                                is_disabled={!selected_ids.length}
                                text={localize('Add {{count}} to my bots', { count: String(selected_ids.length) })}
                                onClick={handle_add_selected}
                            />
                        </div>
                    </div>
                    <div className='bot-importer__findings-list'>
                        {pending.map(bot => (
                            <label key={bot.id} className='bot-importer__finding'>
                                <input
                                    type='checkbox'
                                    checked={selected_ids.includes(bot.id)}
                                    onChange={() => toggle_pending(bot.id)}
                                />
                                <span className='bot-importer__finding-name'>{bot.name}</span>
                                <span className='bot-importer__finding-source'>{bot.source_url}</span>
                            </label>
                        ))}
                    </div>
                </section>
            )}

            <section className='bot-importer__library'>
                <div className='bot-importer__findings-head'>
                    <h3>{localize('My bots')}</h3>
                    <Button
                        tertiary
                        has_effect
                        small
                        text={localize('Open Bot Store')}
                        onClick={open_bot_store}
                    />
                </div>
                {library.length === 0 ? (
                    <p className='bot-importer__empty'>
                        {localize('Nothing imported yet. Bots you add here appear in the Bot Store under My bots.')}
                    </p>
                ) : (
                    <div className='bot-importer__library-list'>
                        {library.map(bot => (
                            <div key={bot.id} className='bot-importer__library-row'>
                                <span className='bot-importer__library-name'>{bot.name}</span>
                                <span className='bot-importer__library-date'>
                                    {new Date(bot.added_at).toLocaleDateString()}
                                </span>
                                <div className='bot-importer__library-actions'>
                                    <Button
                                        primary
                                        small
                                        has_effect
                                        text={loading_bot_id === bot.id ? localize('Loading') : localize('Load Bot')}
                                        is_loading={loading_bot_id === bot.id}
                                        is_disabled={is_loading}
                                        onClick={() => loadUserBot(bot)}
                                    />
                                    <Button
                                        tertiary
                                        small
                                        has_effect
                                        text={localize('Remove')}
                                        onClick={() => removeUserBot(bot.id)}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
});

export default BotImporter;
