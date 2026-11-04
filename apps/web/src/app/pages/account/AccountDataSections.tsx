// Settings → Account & data: problems you reported, a download of your data (GDPR), and deleting
// the account, set apart at the end.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import type { DataExportInfo, SecurityInfo } from '@freero/shared';
import { Button, Input, Modal, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { MyProblems } from '../../problems/MyProblems';
import { ExportList } from '../admin/AdminIdentity';
import { SettingsSection } from './Section';
import { errorText, isReauthRequired, needsReauth, ReauthPrompt } from './SecuritySections';
import { t as tr } from './messages';

export function AccountDataSections({ security }: { security: SecurityInfo | null }) {
  return (
    <>
      <SettingsSection id="problems" title={tr('problemsYouReported')} description={tr('problems.description')}>
        <MyProblems />
      </SettingsSection>
      <DataSection />
      <div className="fr-acct-danger">
        <p className="fr-acct-danger__label">{tr('danger.label')}</p>
        <DeleteSection security={security} />
      </div>
    </>
  );
}

/** GDPR: a ZIP of everything Freero keeps about you, built in the background and emailed as a link. */
function DataSection() {
  const notify = useToast();
  const [exports, setExports] = useState<DataExportInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => api.myExports().then(({ exports }) => setExports(exports), () => undefined), []);
  useEffect(() => void refresh(), [refresh]);
  // While one is being prepared, look again now and then.
  const preparing = exports.some((e) => e.status === 'pending' || e.status === 'running');
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [preparing, refresh]);
  const ask = async () => {
    setBusy(true);
    try {
      await api.requestMyExport();
      notify(tr('preparingYourDataWeLl'), 'success');
      void refresh();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : tr('couldNotStartTheExport'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection id="data" title={tr('yourData')} description={tr('data.description')}>
      <ExportList exports={exports} />
      <div>
        <Button icon={Download} loading={busy} disabled={preparing} onClick={() => void ask()}>
          {preparing ? tr('preparing') : tr('downloadMyData')}
        </Button>
      </div>
    </SettingsSection>
  );
}

function DeleteSection({ security }: { security: SecurityInfo | null }) {
  const { user, adopt } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const askPassword = security?.hasPassword ?? true;
  const blocked = !askPassword && (reauth || needsReauth(security));

  const confirm = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { deletionScheduledFor } = await api.deleteAccount(password);
      const day = new Date(deletionScheduledFor).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      navigate('/login', { replace: true }); // before signing out here, or the guard adds ?next=/settings
      adopt(null);
      notify(tr('yourAccountWillBeDeleted', { day }), 'info', { duration: 12_000 });
    } catch (err) {
      if (isReauthRequired(err)) setReauth(true);
      else setError(errorText(err, tr('couldNotDeleteTheAccount')));
      setBusy(false);
    }
  };

  return (
    <SettingsSection id="delete" title={tr('deleteAccount')} description={tr('removesYourAccountEveryBoard')} danger>
      <div className="fr-acct-form__row">
        <Button variant="danger" icon={Trash2} onClick={() => (setOpen(true), setPassword(''), setError(null))}>{tr('deleteMyAccount')}</Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={tr('deleteYourAccount')}
        width={460}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{tr('cancel')}</Button>
            <Button variant="danger" loading={busy} disabled={(askPassword && !password) || blocked} onClick={() => confirm()}>{tr('deleteAccount')}</Button>
          </>
        }
      >
        <form className="fr-acct-form" onSubmit={confirm} noValidate>
          <p className="fr-acct__p">{tr('youLlBeSignedOut')}</p>
          {askPassword ? (
            <Input
              label={tr('enterYourPasswordToConfirm')}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error ?? undefined}
            />
          ) : blocked && security ? (
            <ReauthPrompt security={security} section="delete" />
          ) : error ? (
            <p className="fr-acct__error" role="alert">{error}</p>
          ) : null}
          <button type="submit" hidden />
        </form>
      </Modal>
    </SettingsSection>
  );
}
