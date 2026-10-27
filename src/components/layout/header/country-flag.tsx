import classNames from 'classnames';

/**
 * The account avatar, drawn the way chichitraders draws it: the United States
 * flag for a real account, a bold "D" for a demo one.
 *
 * Both marks are inline — no remote image — so the avatar is there on the first
 * paint and cannot fail to load.
 */
export const RealAccountFlag = () => (
    <svg
        className='acc-info__real-account-flag'
        viewBox='0 0 48 48'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        focusable='false'
    >
        <rect width='48' height='48' fill='#ffffff' />
        <path d='M0 4h48v4H0zM0 12h48v4H0zM0 20h48v4H0zM0 28h48v4H0zM0 36h48v4H0zM0 44h48v4H0z' fill='#d7193f' />
        <path d='M0 0h25v26H0z' fill='#16458d' />
        <path
            d='M4 4h2v2H4zM11.5 4h2v2h-2zM19 4h2v2h-2zM7.5 9h2v2h-2zM15 9h2v2h-2zM4 14h2v2H4zM11.5 14h2v2h-2zM19 14h2v2h-2zM7.5 19h2v2h-2zM15 19h2v2h-2z'
            fill='#ffffff'
        />
    </svg>
);

export const DemoAccountMark = () => (
    <span className='acc-info__demo-account-mark' aria-hidden='true'>
        D
    </span>
);

type TAccountAvatar = {
    is_virtual?: boolean;
    /** Wrapper class — `acc-info__id` in the chip, smaller inside the dropdown. */
    className?: string;
};

const AccountAvatar = ({ is_virtual, className = 'acc-info__id' }: TAccountAvatar) => (
    <span
        className={classNames(className, { [`${className}--virtual`]: is_virtual })}
        aria-hidden='true'
        data-testid='dt_account_avatar'
    >
        {is_virtual ? <DemoAccountMark /> : <RealAccountFlag />}
    </span>
);

export default AccountAvatar;
