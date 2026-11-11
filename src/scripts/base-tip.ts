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
  const walletInfo = pick<HTMLElement>('[data-tip-wallet-info]');
  const amountStep = pick<HTMLElement>('[data-tip-step-amount]');
  const reviewStep = pick<HTMLElement>('[data-tip-step-review]');
  const outcomeStep = pick<HTMLElement>('[data-tip-step-outcome]');
  const back = pick<HTMLButtonElement>('[data-tip-back]');
  const retry = pick<HTMLButtonElement>('[data-tip-retry]');
  const stepReviewAmount = pick<HTMLElement>('[data-tip-step-review-amount]');
  const outcomeAmount = pick<HTMLElement>('[data-tip-outcome-amount]');

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
    amountStep.hidden = next !== 1;
    reviewStep.hidden = next !== 2;
    outcomeStep.hidden = next !== 3;
    if (focus) (next === 1 ? amountStep : next === 2 ? reviewStep : outcomeStep).querySelector<HTMLElement>('h4')?.focus();
  };

  const setStatus = (text: string) => { status.textContent = text; };
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
    stepReviewAmount.textContent = amount ? `${amount.eth} ETH` : '';
    outcomeAmount.textContent = amount ? `${amount.eth} ETH` : '';
    walletInfo.textContent = account && !ready ? `Selected wallet: ${account}` : '';
    review.hidden = !ready;
    if (ready && account && amount) {
      accountDisplay.textContent = account;
    }
  };
  const invalidate = (message: string) => {
    revision++;
    ready = false;
    if (!hash) setStatus(message);
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
        setStatus('Wallet changed after a transaction hash was returned. Base origin is not verified; inspect wallet history.');
      }
      return;
    }
    if (sendAttempted) {
      provenanceUncertain = true;
      setStatus('Wallet changed while transfer approval is pending. Check the wallet; this page will not make another request.');
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
      setError('No browser wallet detected. You can copy the full address and use your own wallet on Base.');
      setStatus('No wallet connected; no transfer was requested.');
      return;
    }
    busy = true;
    ready = false;
    setError();
    setStatus('Connecting wallet. Approve or reject in your wallet; this does not send funds.');
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
        setStatus('Switching to Base Mainnet. Approve or reject the network change in your wallet; no funds are sent.');
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
      setStatus('Ready for wallet transfer review. Nothing has been sent.');
    } catch (cause) {
      ready = false;
      if (rejected(cause)) setError('Wallet connection or network switch declined. Your amount is kept; retry when ready.');
      else if (cause && typeof cause === 'object' && 'code' in cause && String((cause as {code: unknown}).code) === '4902') {
        setError('Your wallet does not recognize Base Mainnet. Add it yourself through a trusted wallet interface; this site will not add a network.');
      } else setError('Wallet review could not be completed. Check your account and Base network in the wallet, then retry.');
      setStatus('No transfer was requested. Your amount is still selected.');
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
      : 'Submitted; confirmation not verified. Check the transaction on BaseScan.');
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
          if (/^0x0*1$/.test(value)) { provenanceUncertain = false; receiptLink.hidden = false; receiptOutcome = 'confirmed'; setStatus('Thank you for the support! Your tip is confirmed on Base.'); return; }
          if (/^0x0+$/.test(value)) { provenanceUncertain = false; receiptLink.hidden = false; receiptOutcome = 'failed'; setError('Failed on Base: the transaction receipt reports failure.'); setStatus('Submitted transaction failed on-chain.'); return; }
          break;
        }
        if (receipt) break; // An unrecognized receipt is not proof of success.
      } catch { break; }
      await new Promise(resolve => window.setTimeout(resolve, 3000));
    }
    receiptOutcome = 'unverified';
    setStatus(provenanceUncertain
      ? 'Wallet returned a transaction hash; Base origin and confirmation are not verified. Inspect wallet history.'
      : 'Submitted; confirmation not verified here. Check the original transaction on BaseScan.');
  };

  send.addEventListener('click', async () => {
    if (!provider || !account || !amount || !ready || busy || sendAttempted || hash) return;
    const selectedAccount = account;
    const selectedWei = amount.wei;
    const wallet = provider;
    const before = revision;
    busy = true;
    setError();
    setStatus('Checking wallet account and Base Mainnet before opening transfer review.');
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
      setStatus('Awaiting wallet approval. Verify destination, Base network and ETH amount in your wallet; you may reject.');
      refresh();
      const response = await wallet.request({ method: 'eth_sendTransaction', params: [{ from: selectedAccount, to: TIP_RECIPIENT, value: `0x${selectedWei.toString(16)}` }] });
      if (typeof response !== 'string' || !baseScanUrl(response)) {
        setError('Wallet returned an unrecognized transaction reference. Check your wallet history before doing anything else; this page will not resend.');
        setStatus('Transfer outcome unknown; no verified transaction hash.');
        return;
      }
      showHash(response);
      void pollReceipt(response, wallet);
    } catch (cause) {
      if (!sendAttempted) {
        setError('Wallet check failed before any transfer request. Review your account and Base network again.');
        setStatus('No transfer was requested. Your amount is still selected.');
      } else if (rejected(cause)) {
        sendAttempted = false;
        setError('Transfer rejected in your wallet. No transaction hash was returned; your amount is kept. Review again to retry.');
        setStatus('Transfer cancelled. No transaction was submitted by this page.');
      } else {
        sendAttempted = true;
        setError('Wallet returned an uncertain transfer error. Check wallet history; this page will not retry or risk a duplicate.');
        setStatus('Transfer outcome unknown; no verified transaction hash.');
      }
      ready = false;
    } finally {
      busy = false;
      refresh();
      if (step === 3) status.focus();
      else if (amount) connect.focus();
    }
  });

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
  setStatus('');
  refresh();
}
