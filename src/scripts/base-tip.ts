// A wallet-only, user-initiated Base ETH transfer. No keys, contract calls, or automatic sends.
export const BASE_CHAIN_ID = '0x2105';
export const TIP_RECIPIENT = '0xf397Cd712E2901661d48b7c5a07DACd5F0A97150';
const WEI_PER_ETH = 10n ** 18n;
const MAX_WEI = WEI_PER_ETH / 10n;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
type Receipt = { transactionHash?: unknown; status?: unknown; blockHash?: unknown; blockNumber?: unknown };

export function parseEthAmount(input: string): { eth: string; wei: bigint } | null {
  const value = input.trim();
  const parts = /^(\d+)(?:\.(\d{1,18}))?$/.exec(value);
  if (!parts) return null;
  const whole = BigInt(parts[1]);
  const fraction = parts[2] ?? '';
  const wei = whole * WEI_PER_ETH + BigInt(fraction.padEnd(18, '0') || '0');
  if (wei <= 0n || wei > MAX_WEI) return null;
  const meaningfulFraction = fraction.replace(/0+$/, '');
  return { eth: `${whole}${meaningfulFraction ? `.${meaningfulFraction}` : ''}`, wei };
}

export function baseScanUrl(hash: string): string | null {
  return HASH.test(hash) ? `https://basescan.org/tx/${hash}` : null;
}

function isBase(value: unknown): boolean {
  return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) && BigInt(value) === 8453n;
}
function isAddress(value: unknown): value is string { return typeof value === 'string' && ADDRESS.test(value); }
function isReceipt(value: unknown, hash: string): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Receipt;
  return typeof receipt.transactionHash === 'string' && receipt.transactionHash.toLowerCase() === hash.toLowerCase() &&
    typeof receipt.status === 'string' &&
    typeof receipt.blockHash === 'string' && HASH.test(receipt.blockHash) &&
    typeof receipt.blockNumber === 'string' && /^0x[0-9a-f]+$/i.test(receipt.blockNumber) && BigInt(receipt.blockNumber) > 0n;
}
function rejected(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && String((error as { code: unknown }).code) === '4001';
}

export function initBaseTip(): void {
  const panel = document.querySelector<HTMLElement>('[data-tip-panel]');
  if (!panel) return;
  const pick = <T extends Element>(selector: string): T => {
    const node = panel.querySelector<T>(selector);
    if (!node) throw new Error(`Tip interface missing ${selector}`);
    return node;
  };
  const drawerToggle = pick<HTMLButtonElement>('[data-tip-drawer-toggle]');
  const drawerBody = pick<HTMLElement>('[data-tip-drawer-body]');
  const form = pick<HTMLElement>('[data-tip-form]');
  const copy = pick<HTMLButtonElement>('[data-tip-copy]');
  const copyStatus = pick<HTMLElement>('[data-tip-copy-status]');
  const manualToggle = pick<HTMLButtonElement>('[data-tip-manual-toggle]');
  const manualView = pick<HTMLDetailsElement>('[data-tip-manual-view]');
  const manualHeading = pick<HTMLElement>('[data-tip-manual-heading]');
  const manualBack = pick<HTMLButtonElement>('[data-tip-manual-back]');
  const presets = [...panel.querySelectorAll<HTMLButtonElement>('[data-tip-preset]')];
  const error = pick<HTMLElement>('[data-tip-error]');
  const status = pick<HTMLElement>('[data-tip-status]');
  const connect = pick<HTMLButtonElement>('[data-tip-connect]');
  const send = pick<HTMLButtonElement>('[data-tip-send]');
  const review = pick<HTMLElement>('[data-tip-review]');
  const accountDisplay = pick<HTMLElement>('[data-tip-account]');
  const receiptLink = pick<HTMLAnchorElement>('[data-tip-receipt]');
  const hashDisplay = pick<HTMLElement>('[data-tip-hash]');
  const hashValue = pick<HTMLElement>('[data-tip-hash-value]');
  const amountStep = pick<HTMLElement>('[data-tip-step-amount]');
  const reviewStep = pick<HTMLElement>('[data-tip-step-review]');
  const outcomeStep = pick<HTMLElement>('[data-tip-step-outcome]');
  const back = pick<HTMLButtonElement>('[data-tip-back]');
  const retry = pick<HTMLButtonElement>('[data-tip-retry]');
  const screenReadout = pick<HTMLElement>('[data-tip-crt-state]');
  const screenLabel = pick<HTMLElement>('[data-tip-crt-label]');
  const screenDetail = pick<HTMLElement>('[data-tip-crt-detail]');
  const screenAmountRow = pick<HTMLElement>('[data-tip-crt-amount-row]');
  const screenAmount = pick<HTMLElement>('[data-tip-crt-amount]');
  const screenStates = {
    idle: 'FUEL THE NIGHT SHIFT',
    review: 'REVIEW YOUR TIP',
    connecting: 'CONNECTING WALLET',
    network: 'SWITCH TO BASE',
    ready: 'READY TO SEND',
    approval: 'AWAITING WALLET APPROVAL',
    pending: 'SUBMITTED · CONFIRMING',
    confirmed: 'FUEL RECEIVED · THANK YOU',
    failed: 'TRANSACTION FAILED',
    unverified: 'STATUS UNVERIFIED',
    declined: 'APPROVAL DECLINED',
    unavailable: 'WALLET UNAVAILABLE',
    manual: 'SEND MANUALLY',
  };
  const setScreenState = (state: keyof typeof screenStates) => {
    screenReadout.dataset.tipCrtState = state;
    screenLabel.textContent = screenStates[state];
    const showAmount = !!amount && state !== 'idle' && state !== 'manual';
    screenAmountRow.hidden = !showAmount;
    screenAmount.textContent = showAmount ? amount!.eth : '';
    screenReadout.classList.toggle('has-amount', showAmount);
    const details: Record<keyof typeof screenStates, string> = {
      idle: 'Choose an optional ETH tip below.',
      review: 'Check the recipient below. Connecting does not send funds.',
      connecting: 'Approve the connection in your wallet. No funds sent.',
      network: 'Approve the network change in your wallet. No funds sent.',
      ready: 'The next step opens your wallet for transfer approval.',
      approval: 'Check your wallet to approve or decline the transfer.',
      pending: 'Waiting for a receipt. Do not send again.',
      confirmed: 'Receipt verified.',
      failed: 'The on-chain receipt reports failure. Check BaseScan.',
      unverified: 'Check wallet history before doing anything else. Do not resend.',
      declined: 'Request declined. Your amount is kept; you can retry.',
      unavailable: 'Use a browser wallet, or go back and send manually.',
      manual: 'ETH only. Other assets or networks may be lost.',
    };
    screenDetail.textContent = details[state];
  };

  let amount: ReturnType<typeof parseEthAmount> = null;
  let provider: EthereumProvider | null = null;
  let subscribed: EthereumProvider | null = null;
  let account: string | null = null;
  let ready = false;
  let busy = false;
  let sendAttempted = false;
  let hash: string | null = null;
  let receiptOutcome: 'pending' | 'confirmed' | 'failed' | 'unverified' | null = null;
  let provenanceUncertain = false;
  let revision = 0;
  let step: 1 | 2 | 3 = 1;
  const showStep = (next: 1 | 2 | 3, focus = false) => {
    step = next;
    if (next === 1) setScreenState('idle');
    else if (next === 2) setScreenState('review');
    amountStep.hidden = next !== 1;
    reviewStep.hidden = next !== 2;
    outcomeStep.hidden = next !== 3;
    if (focus) (next === 1 ? amountStep : next === 2 ? reviewStep : outcomeStep).querySelector<HTMLElement>('h4')?.focus();
  };

  const setStatus = (text: string, screenState?: keyof typeof screenStates) => {
    status.textContent = text;
    if (screenState) setScreenState(screenState);
  };
  const setError = (text = '') => { error.textContent = text; };
  const refresh = () => {
    const locked = busy || sendAttempted || !!hash;
    back.disabled = locked;
    retry.hidden = step !== 3 || locked || !!hash;
    connect.disabled = locked || !amount;
    connect.hidden = ready;
    send.disabled = locked || !ready || !amount;
    connect.textContent = account ? 'Review with wallet' : 'Connect wallet';
    presets.forEach(button => {
      button.disabled = busy || !!hash || sendAttempted;
    });
    review.hidden = !ready;
    if (ready && account && amount) {
      accountDisplay.textContent = account;
    }
  };
  const invalidate = (message: string) => {
    revision++;
    ready = false;
    if (!hash) setStatus(message, 'review');
    refresh();
  };
  presets.forEach(button => button.addEventListener('click', () => {
    if (busy || sendAttempted || hash || step !== 1) return;
    const selected = parseEthAmount(button.dataset.tipPreset ?? '');
    if (!selected) { setError('This tip amount is unavailable.'); return; }
    amount = selected;
    setError();
    invalidate('');
    showStep(2, true);
    refresh();
  }));
  back.addEventListener('click', () => {
    if (busy || sendAttempted || hash || step !== 2) return;
    account = null;
    amount = null;
    invalidate('');
    setError();
    showStep(1, true);
    refresh();
  });
  retry.addEventListener('click', () => {
    if (busy || sendAttempted || hash || step !== 3) return;
    account = null;
    invalidate('No transaction hash was returned. Review the Base network, amount and address again before connecting.');
    setError();
    showStep(2, true);
    refresh();
  });

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(TIP_RECIPIENT);
      copyStatus.textContent = 'Address copied. Check the full address and Base network in your wallet.';
    } catch {
      copyStatus.textContent = 'Copy unavailable. Select the full address above to copy it manually.';
    }
  });

  const changed = () => {
    if (hash) {
      if (receiptOutcome === 'pending' || receiptOutcome === 'unverified') {
        provenanceUncertain = true;
        receiptLink.hidden = true;
        setStatus('Wallet changed after a transaction hash was returned. Base origin is not verified; inspect wallet history.', 'unverified');
      }
      return;
    }
    if (sendAttempted) {
      provenanceUncertain = true;
      setStatus('Wallet changed while transfer approval is pending. Check the wallet; this page will not make another request.', 'unverified');
      return;
    }
    const hadReview = ready;
    account = null;
    invalidate('Wallet account or network changed. Review again before any transfer.');
    if (hadReview && !busy && amount) connect.focus();
  };
  const obtainProvider = (): EthereumProvider | null => {
    const candidate = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    return candidate && typeof candidate.request === 'function' ? candidate : null;
  };

  connect.addEventListener('click', async () => {
    if (busy || sendAttempted || hash || !amount) return;
    provider = obtainProvider();
    if (!provider) {
      setError();
      setStatus('No wallet connected; no transfer was requested.', 'unavailable');
      return;
    }
    busy = true;
    ready = false;
    setError();
    setStatus('Connecting wallet. Approve or reject in your wallet; this does not send funds.', 'connecting');
    refresh();
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const selected = Array.isArray(accounts) ? accounts[0] : null;
      if (!isAddress(selected)) throw new Error('Wallet did not provide a valid account.');
      account = selected;
      if (subscribed !== provider) {
        subscribed?.removeListener?.('accountsChanged', changed);
        subscribed?.removeListener?.('chainChanged', changed);
        provider.on?.('accountsChanged', changed);
        provider.on?.('chainChanged', changed);
        subscribed = provider;
      }
      let chain = await provider.request({ method: 'eth_chainId' });
      if (!isBase(chain)) {
        setStatus('Switching to Base Mainnet. Approve or reject the network change in your wallet; no funds are sent.', 'network');
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID }] });
        chain = await provider.request({ method: 'eth_chainId' });
      }
      const reviewRevision = revision;
      const current = await provider.request({ method: 'eth_accounts' });
      const finalChain = await provider.request({ method: 'eth_chainId' });
      if (revision !== reviewRevision || !isBase(chain) || !isBase(finalChain) || !Array.isArray(current) || !isAddress(current[0]) || current[0].toLowerCase() !== selected.toLowerCase()) {
        throw new Error('Wallet account or network changed. Review again before any transfer.');
      }
      account = current[0];
      ready = true;
      setStatus('Ready for wallet transfer review. Nothing has been sent.', 'ready');
    } catch (cause) {
      ready = false;
      if (rejected(cause)) setError();
      else if (cause && typeof cause === 'object' && 'code' in cause && String((cause as {code: unknown}).code) === '4902') {
        setError('Your wallet does not recognize Base Mainnet. Add it yourself through a trusted wallet interface; this site will not add a network.');
      } else setError('Wallet review could not be completed. Check your account and Base network in the wallet, then retry.');
      setStatus('No transfer was requested. Your amount is still selected.', rejected(cause) ? 'declined' : 'review');
    } finally {
      busy = false;
      refresh();
      if (ready) send.focus();
      else if (amount) connect.focus();
    }
  });

  const showHash = (txHash: string) => {
    hash = txHash;
    receiptOutcome = 'pending';
    hashValue.textContent = txHash;
    hashDisplay.hidden = false;
    receiptLink.href = baseScanUrl(txHash)!;
    receiptLink.hidden = provenanceUncertain;
    ready = false;
    setStatus(provenanceUncertain
      ? 'Wallet returned a transaction hash, but Base origin is not verified after a wallet change. Inspect wallet history.'
      : 'Submitted; confirmation not verified. Check the transaction on BaseScan.', provenanceUncertain ? 'unverified' : 'pending');
    refresh();
    status.focus();
  };
  const pollReceipt = async (txHash: string, wallet: EthereumProvider) => {
    for (let check = 0; check < 20; check++) {
      try {
        if (!isBase(await wallet.request({ method: 'eth_chainId' }))) { provenanceUncertain = true; receiptLink.hidden = true; break; }
        const receipt = await wallet.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
        if (!isBase(await wallet.request({ method: 'eth_chainId' }))) { provenanceUncertain = true; receiptLink.hidden = true; break; }
        if (isReceipt(receipt, txHash)) {
          const value = (receipt.status as string).toLowerCase();
          if (/^0x0*1$/.test(value)) { provenanceUncertain = false; receiptLink.hidden = false; receiptOutcome = 'confirmed'; setStatus('Thank you for the support! Your tip is confirmed on Base.', 'confirmed'); return; }
          if (/^0x0+$/.test(value)) { provenanceUncertain = false; receiptLink.hidden = false; receiptOutcome = 'failed'; setError(); setStatus('Submitted transaction failed on-chain.', 'failed'); return; }
          break;
        }
        if (receipt) break; // An unrecognized receipt is not proof of success.
      } catch { break; }
      await new Promise(resolve => window.setTimeout(resolve, 3000));
    }
    receiptOutcome = 'unverified';
    setStatus(provenanceUncertain
      ? 'Wallet returned a transaction hash; Base origin and confirmation are not verified. Inspect wallet history.'
      : 'Submitted; confirmation not verified here. Check the original transaction on BaseScan.', 'unverified');
  };

  send.addEventListener('click', async () => {
    if (!provider || !account || !amount || !ready || busy || sendAttempted || hash) return;
    const selectedAccount = account;
    const selectedWei = amount.wei;
    const wallet = provider;
    const before = revision;
    busy = true;
    setError();
    setStatus('Checking wallet account and Base Mainnet before opening transfer review.', 'review');
    refresh();
    try {
      const current = await wallet.request({ method: 'eth_accounts' });
      const chain = await wallet.request({ method: 'eth_chainId' });
      if (revision !== before || !Array.isArray(current) || !isAddress(current[0]) || current[0].toLowerCase() !== selectedAccount.toLowerCase() || !isBase(chain)) {
        invalidate('Wallet account or network changed. Review again; no transfer was requested.');
        return;
      }
      sendAttempted = true;
      provenanceUncertain = false;
      ready = false;
      showStep(3, true);
      setStatus('Awaiting wallet approval. Verify destination, Base network and ETH amount in your wallet; you may reject.', 'approval');
      refresh();
      const response = await wallet.request({ method: 'eth_sendTransaction', params: [{ from: selectedAccount, to: TIP_RECIPIENT, value: `0x${selectedWei.toString(16)}` }] });
      if (typeof response !== 'string' || !baseScanUrl(response)) {
        setError('Your wallet returned an unrecognized transaction reference.');
        setStatus('Transfer outcome unknown; no verified transaction hash.', 'unverified');
        return;
      }
      showHash(response);
      void pollReceipt(response, wallet);
    } catch (cause) {
      if (!sendAttempted) {
        setError('Wallet check failed before any transfer request. Review your account and Base network again.');
        setStatus('No transfer was requested. Your amount is still selected.', 'review');
      } else if (rejected(cause)) {
        sendAttempted = false;
        setError();
        setStatus('Transfer cancelled. No transaction was submitted by this page.', 'declined');
      } else {
        sendAttempted = true;
        setError('Your wallet reported an uncertain transfer error.');
        setStatus('Transfer outcome unknown; no verified transaction hash.', 'unverified');
      }
      ready = false;
    } finally {
      busy = false;
      refresh();
      if (step === 3) status.focus();
      else if (amount) connect.focus();
    }
  });

  const showManual = (manual: boolean) => {
    panel.classList.toggle('is-manual', manual);
    setScreenState(manual ? 'manual' : 'idle');
    form.inert = manual;
    manualView.inert = !manual;
    copyStatus.textContent = '';
    if (manual) manualHeading.focus({ preventScroll: true });
    else manualToggle.focus({ preventScroll: true });
  };
  manualToggle.addEventListener('click', () => showManual(true));
  manualBack.addEventListener('click', () => showManual(false));
  manualToggle.hidden = false;
  manualBack.hidden = false;
  manualHeading.hidden = false;
  manualView.open = true;
  manualView.inert = true;

  drawerToggle.addEventListener('click', () => {
    const open = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', open);
    drawerBody.inert = !open;
    drawerToggle.setAttribute('aria-expanded', String(open));
    drawerToggle.querySelector<HTMLElement>('.tip-trigger-icon')!.textContent = open ? '←' : '→';
    panel.dispatchEvent(new Event('tip-drawer-toggle'));
  });
  form.hidden = false;
  copy.hidden = false;
  drawerBody.inert = true;
  drawerToggle.hidden = false;
  panel.classList.add('is-enhanced');
  setStatus('', 'idle');
  refresh();
}
