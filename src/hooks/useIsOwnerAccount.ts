import { useApiBase } from '@/hooks/useApiBase';
import { isOwnerLoginid } from '@/utils/owner-access';

/**
 * Whether the *authenticated* account may export strategies (save to this
 * device, save to Google Drive, download a block). See utils/owner-access.ts for
 * the allowlist itself — nothing here can be spoofed from the client, because
 * the id comes from the account the WebSocket is authorised for.
 */
export const useIsOwnerAccount = (): boolean => {
    const { activeLoginid } = useApiBase();
    return isOwnerLoginid(activeLoginid);
};

export default useIsOwnerAccount;
