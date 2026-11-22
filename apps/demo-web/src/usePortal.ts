import { useCallback, useEffect, useRef, useState } from 'react';
import { DemoMemberIdSchema } from '@interface-ai/contracts';
import type { DemoAccount, DemoMember, DemoOverview, DemoSearch, DemoSession } from '@interface-ai/contracts';
import { api, PortalError } from './api';

export type Screen = 'workspace' | 'search' | 'overview' | 'accounts' | 'details';
export interface Route { screen: Screen; memberId?: string; accountId?: string }
export interface View { route: Route; member: DemoMember | null; accounts: DemoAccount[]; account: DemoAccount | null; notice: string;
  conflictingSignals: boolean; overview: DemoOverview | null; result: DemoSearch | null; loading: boolean; error: string; errorCode: string; inputError: string; input: string }
const initial: View = { route: { screen: 'workspace' }, member: null, accounts: [], account: null, notice: '', overview: null, result: null,
  conflictingSignals:false, loading: true, error: '', errorCode: '', inputError: '', input: '' };
const screens = ['workspace', 'search', 'overview', 'accounts', 'details'];
const notify = (type: 'context-changing' | 'context-changed') => window.parent.postMessage({ channel: 'demo-staff', type }, window.location.origin);
export function usePortal() {
  const [view, setView] = useState(initial);
  const session = useRef<DemoSession | null>(null);
  const serial = useRef(0); const controller = useRef<AbortController | null>(null);
  const route = useRef<Route>({ screen: 'workspace' });
  const begin = useCallback((next: Route) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const version = ++serial.current; route.current = next;
    setView({ ...initial, route: next, loading: true, member: ['overview', 'accounts', 'details'].includes(next.screen) ? session.current?.activeMember ?? null : null });
    return { signal: abort.signal, current: () => version === serial.current && !abort.signal.aborted };
  }, []);
  const failure = (error: unknown, token: { current(): boolean }) => {
    if (!token.current()) return;
    if(error instanceof PortalError&&error.code==='STAFF_SESSION_EXPIRED')window.parent.postMessage({channel:'demo-staff',type:'staff-expired'},window.location.origin);
    setView((value) => ({ ...value, member: error instanceof PortalError && ['ACCESS_DENIED','INQUIRY_UNAVAILABLE','SERVICING_NOTICE_REQUIRED','MANUAL_REVIEW_REQUIRED','STAFF_SESSION_EXPIRED'].includes(error.code) ? value.member : null, accounts: [], account: null, overview: null, loading: false, error: error instanceof PortalError ? error.message : 'Member services are temporarily unavailable. Try again.', errorCode: error instanceof PortalError ? error.code : 'UNAVAILABLE' }));
  };
  const navigate = useCallback(async (next: Route, historyMode: 'push' | 'replace' | 'none' = 'push') => {
    const token = begin(next);
    if (next.screen === 'workspace' || next.screen === 'search') notify('context-changing');
    try {
      if (next.screen === 'workspace' || next.screen === 'search') {
        await api.reset(token.signal); if (!token.current()) return;
        if (session.current) session.current = { ...session.current, activeMember: null };
        notify('context-changed');
        setView({ ...initial, route: next, loading: false });
      } else {
        const currentSession = await api.session(token.signal); if (!token.current()) return;
        session.current = currentSession;
        const member = currentSession.activeMember;
        if (!member || (next.memberId && next.memberId !== member.id)) throw new PortalError('MEMBER_CONTEXT_CHANGED', 'Member context changed. Start a new search.');
        next = { ...next, memberId: member.id }; route.current = next;
        if (next.screen === 'overview') {
          const data = await api.overview(member.id, token.signal); if (!token.current()) return;
          setView({ ...initial, route: next, loading: false, member: data.member, overview: data });
        } else if (next.screen === 'accounts') {
          const data = await api.accounts(member.id, token.signal); if (!token.current()) return;
          setView({ ...initial, route: next, loading: false, member: data.member, accounts: data.accounts, conflictingSignals:data.conflictingSignals ?? false });
        } else {
          if (!next.accountId) throw new PortalError('ACCOUNT_NOT_FOUND', 'Choose an account from Account Inquiry.');
          const data = await api.details(member.id, next.accountId, token.signal); if (!token.current()) return;
          setView({ ...initial, route: next, loading: false, member: data.member, account: data.account, notice: data.notice ?? '' });
        }
      }
      if (historyMode !== 'none') window.history[historyMode === 'push' ? 'pushState' : 'replaceState'](next, '', '/servicing#' + next.screen);
    } catch (error) { failure(error, token); }
  }, [begin]);
  useEffect(() => {
    let live = true;
    void api.session().then((value) => {
      if (!live) return; session.current = value;
      const saved: unknown = window.history.state;
      const stored = typeof saved === 'object' && saved !== null && 'screen' in saved && screens.includes(String(saved.screen)) ? saved as Route : null;
      void navigate(stored ?? { screen: value.activeMember ? 'overview' : 'workspace' }, 'replace');
    }).catch((error: unknown) => {
      if (live) setView((state) => ({ ...state, loading: false, error: error instanceof PortalError ? error.message : 'Member services are temporarily unavailable. Try again.' }));
    });
    const back = () => { const next = window.history.state as Route | null; void navigate(next && screens.includes(next.screen) ? next : { screen: 'workspace' }, 'none'); };
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.channel !== 'demo-staff' || event.data?.type !== 'navigate') return;
      if (['workspace', 'search', 'overview', 'accounts'].includes(event.data.screen)) void navigate({ screen: event.data.screen as Screen });
    };
    window.addEventListener('popstate', back); window.addEventListener('message', message);
    return () => { live = false; controller.current?.abort(); serial.current++; window.removeEventListener('popstate', back); window.removeEventListener('message', message); };
  }, [navigate]);
  function input(value: string) {
    controller.current?.abort(); serial.current++;
    setView((state) => ({ ...state, input: value, result: null, loading: false, error: '', inputError: '' }));
  }
  async function search() {
    const id = view.input;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const version = ++serial.current;
    const token = { current: () => version === serial.current && !abort.signal.aborted };
    setView((state) => ({ ...state, result: null, member: null, error: '', inputError: '', loading: false }));
    if (!DemoMemberIdSchema.safeParse(id).success) { setView((state) => ({ ...state, inputError: 'Enter a member ID in the format M1234.' })); return; }
    setView((state) => ({ ...state, loading: true }));
    try {
      notify('context-changing'); const result = await api.search(id, abort.signal); if (!token.current()) return;
      if (session.current) session.current = { ...session.current, activeMember: null };
      notify('context-changed'); setView((state) => ({ ...state, loading: false, result }));
    } catch (error) { failure(error, token); }
  }
  async function select() {
    const result = view.result; if (!result?.member) return;
    const token = begin({ screen: 'overview', memberId: result.member.id });
    try {
      const member = await api.select(result.member.id, result.searchRevision, token.signal); if (!token.current()) return;
      if (session.current) session.current = { ...session.current, activeMember: member };
      notify('context-changed'); await navigate({ screen: 'overview', memberId: member.id });
    } catch (error) { failure(error, token); }
  }
  async function resolve(kind:'acknowledge'|'dismissReview'|'restore') {
    const token=begin(route.current);try{await api[kind]();if(kind==='restore')window.parent.postMessage({channel:'demo-staff',type:'staff-restored'},window.location.origin);if(token.current())await navigate(route.current,'replace');}catch(error){failure(error,token);}
  }
  return { view, input, search, select, navigate, resolve, retry: () => view.route.screen === 'search' ? search() : navigate(route.current, 'replace') };
}
