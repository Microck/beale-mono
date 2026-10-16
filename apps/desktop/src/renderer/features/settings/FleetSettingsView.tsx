import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { Plus, RefreshCw, RotateCw, Settings2 } from 'lucide-react';
import type { FleetAppServer, FleetMachine, FleetSshTestResult, FleetState } from '@beale/app-server-runtime/protocol';
import type { FleetSelection } from '../fleet/FleetSidebar';

export function FleetSettingsView({ state, loadError, selection, onSelect, onStateChange, onRefresh }: {
  state: FleetState | null;
  loadError: string | null;
  selection: FleetSelection;
  onSelect: (selection: FleetSelection) => void;
  onStateChange: (state: FleetState) => void;
  onRefresh: () => Promise<void>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const refresh = async (): Promise<void> => {
    try { await onRefresh(); setError(null); }
    catch (caught) { setError(message(caught)); }
  };
  const change = async (action: () => Promise<FleetState>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      onStateChange(await action());
      return true;
    } catch (caught) {
      setError(message(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const restart = async (id: string, action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRestartingId(id);
    setError(null);
    try { await action(); await onRefresh(); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); setRestartingId(null); }
  };

  if (!state) return <div className="settings-page fleet-settings-page"><section className="settings-form"><header className="settings-form-heading"><h2>{fleetSectionLabel(selection.section)}</h2></header><p className={loadError ? 'settings-form-error' : 'fleet-machine-empty'} role={loadError ? 'alert' : 'status'}>{loadError ?? 'Loading Fleet…'}</p></section></div>;

  const selectedMachine = selection.section === 'machines' ? state.machines.find((machine) => machine.id === selection.itemId) : undefined;
  const selectedServer = selection.section === 'app-servers' ? state.appServers.find((server) => server.id === selection.itemId) : undefined;
  const addingServer = selection.section === 'app-servers' && selection.itemId === 'new';
  if (selectedMachine) return <div className="settings-page fleet-settings-page"><FleetMachineDetails
    key={selectedMachine.id} machine={selectedMachine} busy={busy} error={error}
    onBack={() => onSelect({ section: 'machines', itemId: null })} onChange={change}
  /></div>;
  if (selectedServer || addingServer) return <div className="settings-page fleet-settings-page"><FleetAppServerDetails
    key={selectedServer?.id ?? 'new'} server={selectedServer} busy={busy} error={error}
    onBack={() => onSelect({ section: 'app-servers', itemId: null })}
    onSaved={(id) => onSelect({ section: 'app-servers', itemId: id })}
    onChange={change}
  /></div>;
  if (selection.section === 'app-servers' && selection.itemId === 'local') return <div className="settings-page fleet-settings-page"><section className="settings-form fleet-detail-view" aria-label="Local App Server">
    <header className="settings-form-heading"><h2>Local App Server</h2><p>This machine’s Beale app-server process.</p></header>
    {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
    {restartingId ? <p role="status" className="fleet-machine-empty">Restarting app-server…</p> : null}
    <div className="settings-form-actions"><button type="button" disabled={busy} onClick={() => void restart('local', () => window.beale.restartLocalAppServer())}><RotateCw size={14} aria-hidden="true" />Restart App Server</button></div>
  </section></div>;

  if (selection.section === 'browsers') return <BrowserSettingsView
    key={state.browserHomePage} homePage={state.browserHomePage} browserCount={state.browsers.length}
    busy={busy} error={error} onChange={change}
  />;

  if (selection.section === 'machines') return <div className="settings-page fleet-settings-page"><section className="settings-form" aria-busy={busy}>
    <header className="settings-form-heading"><h2>Virtual Machines</h2><p>Select a VM in the sidebar to configure its run, clone, and SSH settings.</p></header>
    {state.error ? <p className="settings-form-error" role="status">{state.error}</p> : null}
    {state.machines.length === 0 ? <p className="fleet-machine-empty">No VMs were found. Prepare one in Tart or Hyper-V, then refresh Fleet.</p> : null}
    {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
    <div className="settings-form-actions fleet-machine-refresh"><span /><button type="button" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" />Refresh</button></div>
  </section></div>;

  return <div className="settings-page fleet-settings-page"><section className="settings-form" aria-busy={busy}>
    <header className="settings-form-heading"><h2>App Servers</h2><p>Connect to other Beale app servers on this Tailscale network. Configure each server on its own machine.</p></header>
    <div className="settings-form-squircle" aria-label="App servers"><div className="settings-form-control-list fleet-machine-list">
      <div className="settings-form-control-row fleet-machine-row">
        <span className="settings-form-control-copy"><strong>Local App Server</strong><small>This machine’s Beale app-server process.</small></span>
        <button type="button" className="fleet-machine-configure-button" aria-label="Restart local app server" title="Restart local app server" disabled={busy} onClick={() => void restart('local', () => window.beale.restartLocalAppServer())}><RotateCw size={18} aria-hidden="true" /></button>
      </div>
      {state.appServers.length === 0 ? <p className="fleet-machine-empty">No remote app servers are saved.</p> : null}
      {state.appServers.map((server) => <div className="settings-form-control-row fleet-machine-row" key={server.id}>
        <span className="settings-form-control-copy"><strong>{server.name}</strong><small>{server.url}</small></span>
        <span className="fleet-machine-actions">
          <button type="button" className="fleet-machine-configure-button" aria-label={`Restart ${server.name} app server`} title={`Restart ${server.name} app server`} disabled={busy} onClick={() => void restart(server.id, () => window.beale.restartFleetAppServer(server.id))}><RotateCw size={18} aria-hidden="true" /></button>
          <button type="button" className="fleet-machine-configure-button" aria-label={`Configure ${server.name}`} title={`Configure ${server.name}`} disabled={busy} onClick={() => onSelect({ section: 'app-servers', itemId: server.id })}><Settings2 size={18} aria-hidden="true" /></button>
        </span>
      </div>)}
    </div></div>
    {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
    {restartingId ? <p role="status" className="fleet-machine-empty">Restarting app-server…</p> : null}
    <div className="settings-form-actions fleet-machine-refresh"><span /><button type="button" disabled={busy} onClick={() => onSelect({ section: 'app-servers', itemId: 'new' })}><Plus size={14} aria-hidden="true" />Add App Server</button></div>
  </section></div>;
}

function BrowserSettingsView({ homePage, browserCount, busy, error, onChange }: {
  homePage: string;
  browserCount: number;
  busy: boolean;
  error: string | null;
  onChange: (action: () => Promise<FleetState>) => Promise<boolean>;
}): JSX.Element {
  const [url, setUrl] = useState(homePage);
  return <div className="settings-page fleet-settings-page"><section className="settings-form" aria-busy={busy}>
    <header className="settings-form-heading"><h2>Browsers</h2><p>Set the page opened by new browser sessions. Choose available browsers using the checkboxes in the sidebar.</p></header>
    <form className="settings-form-squircle fleet-detail-form" onSubmit={(event) => {
      event.preventDefault();
      void onChange(() => window.beale.configureFleet({ action: 'set-browser-home-page', url: url.trim() }));
    }}>
      <label className="fleet-vm-dialog-field"><span>Default page</span>
        <input type="url" value={url} required maxLength={2048} disabled={busy} placeholder="https://duckduckgo.com" onChange={(event) => setUrl(event.currentTarget.value)} />
        <small>Used when opening a new browser page. Existing pages keep their current location.</small>
      </label>
      {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
      <div className="settings-form-actions"><button type="submit" className="primary-button" disabled={busy || url.trim() === homePage}>Save Browser Settings</button></div>
    </form>
    {browserCount === 0 ? <p className="fleet-machine-empty">No browsers were found.</p> : null}
  </section></div>;
}

function fleetSectionLabel(section: FleetSelection['section']): string {
  if (section === 'app-servers') return 'App Servers';
  if (section === 'browsers') return 'Browsers';
  return 'Virtual Machines';
}

function FleetAppServerDetails({ server, busy, error, onBack, onSaved, onChange }: {
  server: FleetAppServer | undefined;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSaved: (serverId: string) => void;
  onChange: (action: () => Promise<FleetState>) => Promise<boolean>;
}): JSX.Element {
  const [serverId] = useState(() => server?.id ?? crypto.randomUUID());
  const [name, setName] = useState(server?.name ?? '');
  const [url, setUrl] = useState(server?.url ?? '');
  const [operatorToken, setOperatorToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const locked = busy || testing;
  const test = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try { setTestResult(await window.beale.testFleetAppServer({ ...(server ? { serverId: server.id } : {}), url: url.trim(), operatorToken: operatorToken.trim() })); }
    catch (caught) { setTestResult({ success: false, message: message(caught) }); }
    finally { setTesting(false); }
  };
  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const saved = await onChange(() => window.beale.configureFleet({
      action: 'set-app-server', serverId, name: name.trim(), url: url.trim(), operatorToken: operatorToken.trim(),
    }));
    if (saved) onSaved(serverId);
  };
  const remove = async (): Promise<void> => {
    if (!server) return;
    const removed = await onChange(() => window.beale.configureFleet({ action: 'remove-app-server', serverId: server.id }));
    if (removed) onBack();
  };
  return (
    <section className="settings-form fleet-detail-view" aria-label={server ? `Configure ${server.name}` : 'Add App Server'}>
      <header className="settings-form-heading"><h2>{server ? server.name : 'Add App Server'}</h2><p>Configure this app server on the current machine.</p></header>
      <form className="settings-form-squircle fleet-detail-form" onSubmit={(event) => void save(event)}>
          <div className="fleet-vm-dialog-fields">
            <label className="fleet-vm-dialog-field"><span>Name</span><input value={name} disabled={locked} onChange={(event) => setName(event.currentTarget.value)} placeholder="Research machine" required /></label>
            <label className="fleet-vm-dialog-field"><span>Tailscale HTTPS URL</span><input value={url} disabled={locked} onChange={(event) => { setUrl(event.currentTarget.value); setTestResult(null); }} placeholder="https://machine.tailnet.ts.net:47174" required /></label>
            <label className="fleet-vm-dialog-field"><span>Operator token</span><input type="password" value={operatorToken} disabled={locked} onChange={(event) => { setOperatorToken(event.currentTarget.value); setTestResult(null); }} placeholder={server ? 'Saved; enter a new token to replace' : 'Token from the remote app server'} required={!server} /><small>Stored only on this machine. The remote server must already have Tailscale Serve enabled.</small></label>
          </div>
          <div className="fleet-vm-dialog-actions"><button type="button" className="secondary-button" disabled={locked || !url.trim() || (!server && !operatorToken.trim())} onClick={() => void test()}>{testing ? 'Testing…' : 'Test Connection'}</button>
            {testResult ? <p className={testResult.success ? 'fleet-vm-test-success' : 'settings-form-error'} role="status">{testResult.message}</p> : null}
          </div>
          {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
        <div className="settings-form-actions fleet-detail-actions">
          {server ? <button type="button" className="secondary-button" disabled={locked} onClick={() => void remove()}>Remove</button> : null}
          <button type="button" className="secondary-button" disabled={locked} onClick={onBack}>Back</button>
          <button type="submit" className="primary-button" disabled={locked}>Save App Server</button>
        </div>
      </form>
    </section>
  );
}

function FleetMachineDetails({ machine, busy, error, onBack, onChange }: {
  machine: FleetMachine;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onChange: (action: () => Promise<FleetState>) => Promise<boolean>;
}): JSX.Element {
  const [canRun, setCanRun] = useState(machine.canRun);
  const [canClone, setCanClone] = useState(machine.canClone);
  const [guestPlatform, setGuestPlatform] = useState(machine.guestPlatform);
  const [privilege, setPrivilege] = useState(machine.privilege);
  const [sshHost, setSshHost] = useState(machine.sshHost ?? '');
  const [sshUser, setSshUser] = useState(machine.sshUser ?? '');
  const [sshIdentityFile, setSshIdentityFile] = useState('');
  const [clearIdentity, setClearIdentity] = useState(false);
  const [sshKnownHostsFile, setSshKnownHostsFile] = useState('');
  const [clearKnownHosts, setClearKnownHosts] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<FleetSshTestResult | null>(null);
  const [cloneName, setCloneName] = useState('');
  const locked = busy || testing;

  const saveConfiguration = (): Promise<boolean> => onChange(() => window.beale.configureFleet({
      action: 'set-machine', machineId: machine.id, base: canClone && !canRun, canRun, canClone, guestPlatform, privilege,
      sshHost: sshHost.trim(), sshUser: sshUser.trim(),
      ...(clearIdentity || sshIdentityFile.trim() ? { sshIdentityFile: clearIdentity ? '' : sshIdentityFile.trim() } : {}),
      ...(clearKnownHosts || sshKnownHostsFile.trim() ? { sshKnownHostsFile: clearKnownHosts ? '' : sshKnownHostsFile.trim() } : {}),
    }));

  const testConnection = async (): Promise<void> => {
    if (locked) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await window.beale.testFleetVmConnection({
        machineId: machine.id,
        sshHost: sshHost.trim(),
        sshUser: sshUser.trim(),
        ...(clearIdentity || sshIdentityFile.trim() ? { sshIdentityFile: clearIdentity ? '' : sshIdentityFile.trim() } : {}),
        ...(clearKnownHosts || sshKnownHostsFile.trim() ? { sshKnownHostsFile: clearKnownHosts ? '' : sshKnownHostsFile.trim() } : {}),
      }));
    } catch (caught) {
      setTestResult({ success: false, message: message(caught) });
    } finally {
      setTesting(false);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await saveConfiguration();
  };

  const clone = async (): Promise<void> => {
    if (!await saveConfiguration()) return;
    const cloned = await onChange(() => window.beale.cloneFleetVm(machine.id, cloneName.trim()));
    if (cloned) setCloneName('');
  };

  return (
    <section className="settings-form fleet-detail-view" aria-label={`Configure ${machine.name}`}>
      <header className="settings-form-heading"><h2>{machine.name}</h2><p>{machine.backend} · {machine.state}{machine.owner ? ' · Reserved by a session' : ''}</p></header>
      <form className="settings-form-squircle fleet-detail-form" onSubmit={(event) => void save(event)}>
          <div className="fleet-vm-dialog-fields">
            <label className="settings-form-control-row">
              <span className="settings-form-control-copy"><strong>Can Run</strong><small>Allow a workspace session to run commands on this VM.</small></span>
              <input type="checkbox" checked={canRun} disabled={locked || Boolean(machine.owner)} onChange={(event) => setCanRun(event.currentTarget.checked)} />
            </label>
            <label className="settings-form-control-row">
              <span className="settings-form-control-copy"><strong>Can Clone</strong><small>Allow a workspace session to clone this stopped VM.</small></span>
              <input type="checkbox" checked={canClone} disabled={locked || Boolean(machine.owner) || machine.state !== 'stopped'} onChange={(event) => setCanClone(event.currentTarget.checked)} />
            </label>
            <label className="settings-form-control-row">
              <span className="settings-form-control-copy"><strong>Privilege</strong><small>Label this VM's manually configured privilege level.</small></span>
              <select value={privilege} disabled={locked || Boolean(machine.owner)} onChange={(event) => setPrivilege(event.currentTarget.value as FleetMachine['privilege'])}><option value="standard">Standard</option><option value="elevated">Elevated</option></select>
            </label>
            <label className="settings-form-control-row">
              <span className="settings-form-control-copy"><strong>Guest OS</strong><small>Used to format commands sent over SSH.</small></span>
              <select value={guestPlatform} disabled={locked || Boolean(machine.owner)} onChange={(event) => setGuestPlatform(event.currentTarget.value as FleetMachine['guestPlatform'])}><option value="win32">Windows</option><option value="darwin">macOS</option><option value="linux">Linux</option></select>
            </label>
            <label className="fleet-vm-dialog-field"><span>SSH host override</span><input value={sshHost} disabled={locked || Boolean(machine.owner)} placeholder="Auto-detect VM IP" onChange={(event) => { setSshHost(event.currentTarget.value); setTestResult(null); }} /></label>
            <label className="fleet-vm-dialog-field"><span>SSH user</span><input value={sshUser} disabled={locked || Boolean(machine.owner)} placeholder="Guest account name" onChange={(event) => { setSshUser(event.currentTarget.value); setTestResult(null); }} /><small>Beale needs this account name to connect; this does not change SSH inside the VM.</small></label>
            <label className="fleet-vm-dialog-field"><span>SSH identity file</span><input value={sshIdentityFile} disabled={locked || Boolean(machine.owner) || clearIdentity} placeholder={machine.sshIdentityConfigured ? 'Configured; enter a new path to replace' : 'Optional host path'} onChange={(event) => { setSshIdentityFile(event.currentTarget.value); setTestResult(null); }} /></label>
            {machine.sshIdentityConfigured ? (
              <label className="fleet-vm-clear-identity"><input type="checkbox" checked={clearIdentity} disabled={locked || Boolean(machine.owner)} onChange={(event) => { setClearIdentity(event.currentTarget.checked); setTestResult(null); }} />Clear saved SSH identity file</label>
            ) : null}
            <label className="fleet-vm-dialog-field"><span>SSH known-hosts file</span><input value={sshKnownHostsFile} disabled={locked || Boolean(machine.owner) || clearKnownHosts} placeholder={machine.sshKnownHostsConfigured ? 'Configured; enter a new path to replace' : 'Optional host path'} onChange={(event) => { setSshKnownHostsFile(event.currentTarget.value); setTestResult(null); }} /><small>For Tart, Beale uses ~/.ssh/tart_known_hosts when it exists. A first connection to a clone records its host key there.</small></label>
            {machine.sshKnownHostsConfigured ? (
              <label className="fleet-vm-clear-identity"><input type="checkbox" checked={clearKnownHosts} disabled={locked || Boolean(machine.owner)} onChange={(event) => { setClearKnownHosts(event.currentTarget.checked); setTestResult(null); }} />Clear saved known-hosts file</label>
            ) : null}
          </div>
          <div className="fleet-vm-dialog-actions">
            <button type="button" className="secondary-button" disabled={locked} onClick={() => void testConnection()}>{testing ? 'Testing…' : 'Test SSH'}</button>
            {testResult ? <p className={testResult.success ? 'fleet-vm-test-success' : 'settings-form-error'} role="status">{testResult.message}</p> : null}
            {canClone ? <><label className="fleet-vm-dialog-field"><span>Clone name</span><input value={cloneName} disabled={locked} placeholder="New VM name" onChange={(event) => setCloneName(event.currentTarget.value)} /></label>
              <button type="button" className="secondary-button" disabled={locked || machine.state !== 'stopped' || !canClone || !cloneName.trim()} onClick={() => void clone()}>Clone VM</button></> : null}
            {machine.canRun ? <button type="button" className="secondary-button" disabled={locked || Boolean(machine.owner) || machine.state === 'unknown'} onClick={() => void onChange(() => machine.state === 'running' ? window.beale.stopFleetVm(machine.id) : window.beale.startFleetVm(machine.id))}>{machine.state === 'running' ? 'Stop VM' : 'Start VM'}</button> : null}
          </div>
          {error ? <p className="settings-form-error" role="alert">{error}</p> : null}
        <div className="settings-form-actions fleet-detail-actions">
          <button type="button" className="secondary-button" disabled={locked} onClick={onBack}>Back</button>
          <button type="submit" className="primary-button" disabled={locked || Boolean(machine.owner)}>Save VM</button>
        </div>
      </form>
    </section>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
