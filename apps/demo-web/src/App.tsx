import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import type { DemoAccount, DemoMember, DemoSession } from '@interface-ai/contracts';
import { api, bootstrapSession } from './api';
import { usePortal } from './usePortal';
import type { Screen } from './usePortal';

export function money(minor: number) {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Invalid amount.');
  const value = BigInt(minor); return '$' + (value / 100n).toLocaleString('en-US') + '.' + (value % 100n).toString().padStart(2, '0');
}
const product = (account: DemoAccount) => account.type === 'savings' ? account.isPrimary ? 'Primary Savings' : 'Savings' : 'Checking';
function Status({ value }: { value: string }) { return <Badge size="sm" variant="light" color={value === 'active' ? 'teal' : 'gray'}>{value === 'active' ? 'Active' : value === 'closed' ? 'Closed' : 'Inactive'}</Badge>; }
function Field({ label, children, amount = false }: { label: string; children: React.ReactNode; amount?: boolean }) {
  return <div className={amount ? 'field amount-field' : 'field'}><dt>{label}</dt><dd>{children}</dd></div>;
}
function MemberContext({ member }: { member: DemoMember }) {
  return <section aria-label="Active member" className="member-context"><div className="member-mark" aria-hidden="true">{member.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>
    <div><Text size="xs" c="dimmed" tt="uppercase" fw={700}>Active member</Text><Text fw={650}>{member.name}</Text></div>
    <dl><Field label="Member ID">{member.id}</Field><Field label="Membership Status"><Status value={member.status} /></Field></dl>
  </section>;
}
function Workspace() {
  const portal = usePortal(); const { view } = portal;
  const title: Record<Screen, string> = { workspace: 'Staff workspace', search: 'Member Search', overview: 'Member Overview', accounts: 'Account Inquiry', details: 'Account Details' };
  const member = view.member;
  return <main className="servicing-page">
    <div className="page-heading"><div><Text size="xs" c="dimmed" fw={600}>MEMBER SERVICES / {view.route.screen === 'workspace' ? 'WORKSPACE' : 'SERVICING'}</Text><Title order={1}>{title[view.route.screen]}</Title></div>
      {member && <Button size="xs" variant="default" onClick={() => void portal.navigate({ screen: 'search' })}>New member search</Button>}</div>
    {member && <MemberContext member={member} />}
    {view.error && <Alert color={view.errorCode === 'ACCESS_DENIED' ? 'orange' : 'red'} title={view.errorCode === 'ACCESS_DENIED' ? 'Access denied' : 'Unable to continue'} role="alert" mb="md">
      {view.error}<Group mt="sm"><Button size="xs" variant="default" onClick={() => void portal.navigate({ screen: 'search' })}>Start a new search</Button>
      {view.errorCode !== 'ACCESS_DENIED' && <Button size="xs" variant="light" onClick={() => void portal.retry()}>Try again</Button>}</Group></Alert>}
    {view.loading && <Paper withBorder p="xl" role="status" aria-live="polite"><Group><Loader size="sm" /><Text>Loading {title[view.route.screen]}…</Text></Group></Paper>}
    {!view.loading && !view.error && view.route.screen === 'workspace' && <div className="workspace-grid">
      <Paper withBorder className="start-card" p="xl"><div className="service-icon" aria-hidden="true">⌕</div><Title order={2}>Member servicing</Title>
        <Text c="dimmed" my="sm">Find a member, review their accounts, and inspect current and available balances.</Text>
        <Button mt="md" onClick={() => void portal.navigate({ screen: 'search' })}>Start Member Search</Button></Paper>
      <Paper withBorder p="xl"><Title order={2} size="h3">Before you begin</Title><Stack mt="md" gap="md"><Text size="sm">Use the member's identifier to locate their record.</Text><Text size="sm">Confirm the active member before opening an account.</Text><Text size="sm">Current Balance and Available Balance are displayed separately.</Text></Stack></Paper>
    </div>}
    {view.route.screen === 'search' && <>
      <Paper withBorder p="lg"><form aria-label="Member Search" noValidate onSubmit={(event) => { event.preventDefault(); void portal.search(); }}>
        <div className="search-form"><TextInput label="Member ID" name="memberId" id="member-search-id" placeholder="M1234" value={view.input}
          onChange={(event) => portal.input(event.currentTarget.value)} maxLength={5} disabled={view.loading} error={view.inputError || undefined} autoComplete="off" description="Member ID begins with M followed by four digits." />
          <Group className="search-actions" gap="sm"><Button type="submit" disabled={view.loading}>Search</Button><Button variant="default" onClick={() => void portal.navigate({ screen: 'search' })}>Clear</Button></Group></div>
      </form></Paper>
      {!view.loading && !view.error && <section aria-label="Member Search Results" className="results-section">
        <Group justify="space-between" mb="sm"><Title order={2} size="h3">Search results</Title><Text size="sm" c="dimmed">{view.result ? view.result.member ? '1 member found' : '0 members found' : 'Awaiting search'}</Text></Group>
        {view.result ? <><dl className="searched-id"><Field label="Searched Member ID">{view.result.memberId}</Field></dl>
          {view.result.member ? <Paper withBorder className="table-panel"><Table highlightOnHover verticalSpacing="sm"><caption>Member search results</caption><Table.Thead><Table.Tr><Table.Th scope="col">Member ID</Table.Th><Table.Th scope="col">Member Name</Table.Th><Table.Th scope="col">Membership Status</Table.Th><Table.Th scope="col">Action</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody><Table.Tr><Table.Th scope="row">{view.result.member.id}</Table.Th><Table.Td>{view.result.member.name}</Table.Td><Table.Td><Status value={view.result.member.status} /></Table.Td><Table.Td><Button size="xs" variant="light" onClick={() => void portal.select()}>Open</Button></Table.Td></Table.Tr></Table.Tbody></Table></Paper>
            : <Paper withBorder p="xl" role="status"><Title order={3} size="h4">No matching member</Title><Text size="sm" c="dimmed" mt="xs">Check the member ID and search again.</Text></Paper>}</>
          : <Paper withBorder p="xl" className="empty-state"><Text c="dimmed" size="sm">Enter a Member ID to search. Select a result to open the member record.</Text></Paper>}
      </section>}
    </>}
    {!view.loading && !view.error && view.route.screen === 'overview' && view.overview && member && <section aria-label="Member Overview">
      <div className="overview-grid"><Paper withBorder p="lg"><Title order={2} size="h3">Member information</Title><dl className="information-grid">
        <Field label="Member ID">{member.id}</Field><Field label="Member Name">{member.name}</Field><Field label="Membership Status"><Status value={member.status} /></Field><Field label="Servicing Branch">Training Branch</Field>
      </dl></Paper><Paper withBorder p="lg"><Title order={2} size="h3">Account summary</Title>{view.overview.accountSummary ? <div className="summary-grid">
        {[['Total accounts', view.overview.accountSummary.total], ['Savings', view.overview.accountSummary.savings], ['Checking', view.overview.accountSummary.checking]].map(([label, value]) => <div key={label}><Text size="xs" c="dimmed">{label}</Text><Text size="xl" fw={650}>{value}</Text></div>)}
      </div> : <Text c="dimmed" size="sm" mt="lg">Account information is restricted for this member.</Text>}
      <Button mt="lg" onClick={() => void portal.navigate({ screen: 'accounts' })}>Account Inquiry</Button></Paper></div>
      <Paper withBorder p="md" mt="md" className="servicing-notice"><Text size="sm" fw={600}>Servicing information</Text><Text size="sm" c="dimmed">Review the member and account identifiers before completing an inquiry.</Text></Paper>
    </section>}
    {!view.loading && !view.error && view.route.screen === 'accounts' && member && <section aria-label="Account Inquiry">
      <Group justify="space-between" mb="sm"><Text size="sm" c="dimmed">{view.accounts.length} accounts · USD</Text><Button variant="default" size="xs" onClick={() => void portal.navigate({ screen: 'overview' })}>Back to Member Overview</Button></Group>
      {!view.accounts.some((account) => account.type === 'savings' && account.isPrimary) && <Alert color="orange" title="No primary savings account" role="status" mb="md">This member has no designated primary savings account.</Alert>}
      <Paper withBorder className="table-panel"><Table.ScrollContainer minWidth={780}><Table highlightOnHover verticalSpacing="sm"><caption>Member accounts</caption><Table.Thead><Table.Tr>
        {['Account ID', 'Account Type', 'Designation', 'Status', 'Current Balance', 'Available Balance', 'Currency', 'Action'].map((header) => <Table.Th scope="col" key={header}>{header}</Table.Th>)}
      </Table.Tr></Table.Thead><Table.Tbody>{view.accounts.map((account) => <Table.Tr key={account.id}>
        <Table.Th scope="row">{account.id}</Table.Th><Table.Td>{product(account)}</Table.Td><Table.Td>{account.isPrimary ? 'Primary' : 'Standard'}</Table.Td><Table.Td><Status value={account.status} /></Table.Td>
        <Table.Td className="money">{money(account.currentBalanceMinor)}</Table.Td><Table.Td className="money available">{money(account.availableBalanceMinor)}</Table.Td><Table.Td>{account.currency}</Table.Td>
        <Table.Td><Button variant="light" size="xs" onClick={() => void portal.navigate({ screen: 'details', accountId: account.id })}>Open</Button></Table.Td>
      </Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></Paper>
    </section>}
    {!view.loading && !view.error && view.route.screen === 'details' && view.account && member && <section aria-label="Account Details">
      <Group justify="space-between" mb="md"><Text fw={600}>{product(view.account)} · {view.account.id}</Text><Button variant="default" size="xs" onClick={() => void portal.navigate({ screen: 'accounts' })}>Back to Accounts</Button></Group>
      <Paper withBorder p="lg"><dl className="detail-grid">
        <Field label="Member ID">{member.id}</Field><Field label="Account ID">{view.account.id}</Field><Field label="Account Type">{product(view.account)}</Field><Field label="Designation">{view.account.isPrimary ? 'Primary' : 'Standard'}</Field>
        <Field label="Status"><Status value={view.account.status} /></Field><Field label="Currency">{view.account.currency}</Field>
        <Field label="Current Balance" amount>{money(view.account.currentBalanceMinor)}</Field><Field label="Available Balance" amount>{money(view.account.availableBalanceMinor)}</Field>
      </dl></Paper><Text size="xs" c="dimmed" mt="md">Balances are shown in USD. Available Balance may differ due to pending activity.</Text>
    </section>}
  </main>;
}
function BankMark() { return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 10 16 3l13 7v3H3zm3 6h4v10H6zm8 0h4v10h-4zm8 0h4v10h-4zM3 28h26v3H3z" fill="currentColor" /></svg>; }
function StaffShell() {
  const [session, setSession] = useState<DemoSession | null>(null); const [error, setError] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null); const request = useRef(0);
  useEffect(() => {
    let live = true;
    void bootstrapSession().then((value) => { if (live) setSession(value); }).catch(() => { if (live) setError(true); });
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow || event.data?.channel !== 'demo-staff') return;
      if (event.data.type === 'context-changing') { request.current++; setSession((value) => value ? { ...value, activeMember: null } : value); }
      if (event.data.type === 'context-changed') {
        const version = ++request.current;
        void api.session().then((value) => { if (live && version === request.current) setSession(value); }).catch(() => { if (live) setError(true); });
      }
    };
    window.addEventListener('message', message);
    return () => { live = false; window.removeEventListener('message', message); };
  }, []);
  const navigate = (screen: Screen) => iframe.current?.contentWindow?.postMessage({ channel: 'demo-staff', type: 'navigate', screen }, window.location.origin);
  return <div className="staff-shell">
    <header className="staff-header"><div className="institution"><span className="bank-mark"><BankMark /></span><div><Text fw={700} size="lg">Demo Credit Union</Text><Text size="xs" className="brand-subtitle">STAFF SERVICES</Text></div></div>
      <div className="operator-summary"><Badge variant="light" color="teal">Active staff session</Badge><div><Text size="sm" fw={650}>{session?.operator.name ?? 'Staff Services'}</Text><Text size="xs">{session?.operator.id ?? 'Opening workspace'}</Text></div><span className="operator-avatar" aria-hidden="true">AC</span></div>
    </header>
    <aside className="staff-sidebar"><Text className="nav-section" size="xs" fw={700}>WORKSPACE</Text><nav aria-label="Staff navigation">
      <UnstyledButton className="staff-nav" onClick={() => navigate('workspace')}>Staff workspace</UnstyledButton><UnstyledButton className="staff-nav" onClick={() => navigate('search')}>Member Search</UnstyledButton>
      <Text className="nav-section" size="xs" fw={700}>ACTIVE MEMBER</Text>
      <UnstyledButton className="staff-nav" disabled={!session?.activeMember} onClick={() => navigate('overview')}>Member Overview</UnstyledButton>
      <UnstyledButton className="staff-nav" disabled={!session?.activeMember} onClick={() => navigate('accounts')}>Account Inquiry</UnstyledButton>
    </nav><div className="branch-card"><Text size="xs" c="dimmed">Branch</Text><Text size="sm" fw={600}>{session?.operator.branch ?? 'Training Branch'}</Text><Text size="xs" c="dimmed" mt="md">Staff role</Text><Text size="sm">{session?.operator.role ?? 'Member Services'}</Text></div>
    <div className="training-label">TRAINING ENVIRONMENT<br /><span>Synthetic records only</span></div></aside>
    <main className="shell-main"><div className="workspace-toolbar"><Text size="sm" c="dimmed">Staff Services <span aria-hidden="true">/</span> Member servicing</Text><Text size="xs" c="dimmed">{session?.operator.branch ?? 'Training Branch'}</Text></div>
      <div className="active-member-bar" aria-live="polite">{session?.activeMember ? <MemberContext member={session.activeMember} /> : <section aria-label="Active member" className="no-member"><Text size="sm" fw={600}>No member selected</Text><Text size="xs" c="dimmed">Open a member from Member Search to begin an account inquiry.</Text></section>}</div>
      {error ? <Alert color="red" title="Staff services unavailable" role="alert">We could not open the workspace. <Button size="xs" variant="light" onClick={() => window.location.reload()}>Try again</Button></Alert>
        : session ? <iframe ref={iframe} title="Member servicing workspace" src="/servicing" className="servicing-frame" /> : <Paper withBorder p="xl" role="status"><Group><Loader size="sm" /><Text>Opening staff workspace…</Text></Group></Paper>}
    </main>
  </div>;
}
export function App() { return window.location.pathname === '/servicing' ? <Workspace /> : <StaffShell />; }
