"use client";

import { useState, useCallback } from "react";
import { inAppWallet, createWallet, walletConnect } from "thirdweb/wallets";
import {
  useConnect,
  useActiveAccount,
  useDisconnect,
  useActiveWallet,
  useConnectModal,
} from "thirdweb/react";
import { getContract, sendTransaction, prepareContractCall, toWei } from "thirdweb";
import { eth_getBalance, getRpcClient } from "thirdweb/rpc";
import { sepolia } from "thirdweb/chains";
import {
  addAdmin,
  removeAdmin,
  getAllAdmins,
} from "thirdweb/extensions/erc4337";
import {
  linkProfile,
  getProfiles,
  unlinkProfile,
  preAuthenticate,
} from "thirdweb/wallets";
import { client } from "../client";
import { BACKEND_URL } from "../multisig/config";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RecoveryMode = "setup" | "recovery";

export interface SmartAccountState {
  address: string;
  admins: readonly string[];
  isDeployed: boolean;
}

// Profile returned by getProfiles — shape: { type: string; details: { ... } }
export type LinkedProfile = Awaited<ReturnType<typeof getProfiles>>[number];

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useRecovery() {
  const [smartAccount, setSmartAccount] = useState<SmartAccountState | null>(null);
  const [balance,      setBalance]      = useState<string | null>(null);
  const [fetchLoading,  setFetchLoading]  = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ── Send-from-smart-account state (Panel ③) ──────────────────────────────
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError,   setSendError]   = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  // ── Profile linking state (Section A) ─────────────────────────────────────
  const [profiles,    setProfiles]    = useState<LinkedProfile[]>([]);
  const [otpSent,     setOtpSent]     = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError,   setLinkError]   = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  const account                   = useActiveAccount();
  const { connect }               = useConnect();
  const { disconnect }            = useDisconnect();
  const activeWallet              = useActiveWallet();
  const { connect: openWalletUI } = useConnectModal();

  // ── Google OAuth → ERC-4337 Smart Account (Panel ① employee setup) ─────────
  //
  // account.address === Smart Account address (not the raw EOA).
  // addAdmin called on the employee's OWN smart account:
  //   isSelfVerifyingContract = true → raw EOA ECDSA signing → works ✓
  const handleGoogleLogin = async (idToken: string) => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const { jwt } = await res.json();
      await connect(async () => {
        const wallet = inAppWallet({
          executionMode: {
            mode: "EIP4337",
            smartAccount: { chain: sepolia, sponsorGas: true },
          },
        });
        await wallet.connect({ client, strategy: "jwt", jwt, chain: sepolia });
        return wallet;
      });
    } catch {
      setError("Google login failed");
    }
  };

  // ── Google OAuth → plain in-app wallet EOA (Panel ② guardian recovery) ────
  //
  // MUST use plain wallet (no ERC-4337) for guardian signing. Reason:
  //
  //   addAdmin calls signTypedData({ domain: { verifyingContract: employeeSmartAccount } })
  //
  //   ThirdWeb's smartAccountSignTypedData checks:
  //     isSelfVerifyingContract = (verifyingContract === guardian's own smart account)
  //
  //   When guardian uses ERC-4337:
  //     verifyingContract = employee's account ≠ guardian's account
  //     → isSelfVerifyingContract = false
  //     → signs with AccountMessage EIP-1271 wrapper
  //     → employee's contract ecrecover gets the wrong address → "!sig" error
  //
  //   When guardian uses plain wallet:
  //     account.address = guardian's EOA (0x4e2E9ce7…)
  //     signTypedData = raw ECDSA from EOA
  //     → employee's contract ecrecover = 0x4e2E9ce7… → isAdmin check passes ✓
  const handleGuardianGoogleLogin = async (idToken: string) => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const { jwt } = await res.json();
      await connect(async () => {
        // Plain in-app wallet — NO executionMode → account.address = EOA
        // Do NOT pass `chain` here: plain inAppWallet JWT connect schema does
        // not accept it and Zod throws "Input validation failed".
        const wallet = inAppWallet();
        await wallet.connect({ client, strategy: "jwt", jwt });
        return wallet;
      });
    } catch {
      setError("Guardian Google login failed");
    }
  };

  // ── WalletConnect / MetaMask ─────────────────────────────────────────────
  const handleWalletConnect = async () => {
    setError(null);
    try {
      await openWalletUI({
        client,
        chain: sepolia,
        wallets: [
          walletConnect(),
          createWallet("io.metamask"),
          createWallet("com.coinbase.wallet"),
        ],
        showAllWallets: true,
        size: "compact",
        theme: "dark",
        title: "Guardian — Connect Wallet",
        showThirdwebBranding: false,
      });
    } catch {
      setError("Wallet connection failed");
    }
  };

  const handleDisconnect = () => {
    if (activeWallet) disconnect(activeWallet);
  };

  // ── Read admins + ETH balance from any smart account address ─────────────
  const fetchAdmins = useCallback(async (smartAccountAddress: string) => {
    if (!smartAccountAddress.startsWith("0x")) return;
    setFetchLoading(true);
    setError(null);
    try {
      const addr = smartAccountAddress as `0x${string}`;
      const contract = getContract({ client, chain: sepolia, address: addr });
      const rpc = getRpcClient({ client, chain: sepolia });
      const [admins, wei] = await Promise.all([
        getAllAdmins({ contract }),
        eth_getBalance(rpc, { address: addr }),
      ]);
      setSmartAccount({ address: smartAccountAddress, admins, isDeployed: admins.length > 0 });
      setBalance((Number(wei) / 1e18).toFixed(6));
    } catch {
      // Contract not deployed yet or not a ThirdWeb smart account
      setSmartAccount({ address: smartAccountAddress, admins: [], isDeployed: false });
      setBalance(null);
    } finally {
      setFetchLoading(false);
    }
  }, []);

  // ── ① SETUP: Account owner adds a guardian (addAdmin) ─────────────────────
  //
  // Who calls this: Alice (the account owner / initial admin)
  // What it does:
  //   1. account.signTypedData → signs a SignerPermissionRequest (typed-data EIP-712)
  //   2. setPermissionsForSigner(req, signature) is sent to Alice's smart account
  //   3. Contract verifies: ecrecover(hash(req), sig) === existing admin
  //   4. Grants admin role to guardianAddress
  //
  // Gas: sponsored via ERC-4337 Paymaster (Google in-app wallet with EIP4337 mode).
  const handleAddGuardian = async (guardianAddress: string) => {
    if (!account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const contract = getContract({
        client,
        chain: sepolia,
        address: account.address as `0x${string}`,
      });
      const tx = addAdmin({ contract, account, adminAddress: guardianAddress });
      const receipt = await sendTransaction({ transaction: tx, account });
      setSuccess(
        `✓ Guardian を登録しました！\n` +
        `  TX: ${receipt.transactionHash}\n` +
        `  Smart Account  : ${account.address}\n` +
        `  Guardian (新Admin): ${guardianAddress}\n\n` +
        `  Guardian は今後このスマートアカウントの Admin として\n` +
        `  Recovery を実行できます。`
      );
      await fetchAdmins(account.address);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Guardian の追加に失敗しました");
    } finally {
      setActionLoading(false);
    }
  };

  // ── ② RECOVERY: Guardian adds new key + removes lost key ─────────────────
  //
  // Who calls this: Bob (the guardian / existing admin)
  // What it does (2-step):
  //   Step 1 — addAdmin(newKey) on Alice's smart account:
  //     Bob signs a SignerPermissionRequest(signer=newKey, isAdmin=1)
  //     setPermissionsForSigner is called → newKey becomes admin
  //   Step 2 — removeAdmin(lostKey) on Alice's smart account:
  //     Bob signs a SignerPermissionRequest(signer=lostKey, isAdmin=2)
  //     setPermissionsForSigner is called → lostKey loses admin
  //
  // Neither step requires the lost key's signature — guardian acts alone.
  const handleRecover = async (
    smartAccountAddress: string,
    lostKeyAddress:      string,
    newKeyAddress:       string,
    skipRemove:          boolean = false,
  ) => {
    if (!account) return;
    setActionLoading(true);
    setError(null);
    setSuccess(null);

    const contract = getContract({
      client,
      chain: sepolia,
      address: smartAccountAddress as `0x${string}`,
    });

    try {
      // ── Step 1: Add new key as admin ───────────────────────────────────────
      const addTx = addAdmin({ contract, account, adminAddress: newKeyAddress });
      const addReceipt = await sendTransaction({ transaction: addTx, account });

      let msg =
        `✓ 新しい鍵を Admin に追加しました！\n` +
        `  TX (addAdmin)  : ${addReceipt.transactionHash}\n` +
        `  Smart Account  : ${smartAccountAddress}\n` +
        `  新 Admin (復旧先): ${newKeyAddress}\n`;

      // ── Step 2: Remove lost key (optional) ────────────────────────────────
      if (!skipRemove && lostKeyAddress && lostKeyAddress !== newKeyAddress) {
        const removeTx = removeAdmin({ contract, account, adminAddress: lostKeyAddress });
        const removeReceipt = await sendTransaction({ transaction: removeTx, account });
        msg +=
          `\n✓ 紛失した鍵を削除しました！\n` +
          `  TX (removeAdmin): ${removeReceipt.transactionHash}\n` +
          `  旧 Admin (紛失)  : ${lostKeyAddress}`;
      }

      setSuccess(msg);
      await fetchAdmins(smartAccountAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery に失敗しました");
    } finally {
      setActionLoading(false);
    }
  };

  // ── ③ Send ETH from an arbitrary smart account (admin is the executor) ────
  //
  // How it works:
  //   The connected EOA (e.g. 0xd00A23E1) is a registered Admin on the employee's
  //   smart account. ThirdWeb's ManagedAccount exposes:
  //
  //     execute(address _target, uint256 _value, bytes calldata _calldata)
  //       onlyAdminOrEntrypoint
  //
  //   Calling execute() directly (not via EntryPoint) skips UserOperation
  //   signature validation entirely — the contract checks msg.sender == admin.
  //
  //   Note on gas: the admin EOA pays gas for this call. The UserOperation
  //   path (smartWallet + overrides.accountAddress) fails because ThirdWeb
  //   appends signer metadata to the UserOp signature, making it > 65 bytes,
  //   which breaks the employee contract's ECDSA.recover() length check (AA23).
  const handleSendFromEmployeeWallet = async (
    smartAccountAddress: string,
    toAddress: string,
    amountEth: string,
  ) => {
    if (!account) return;
    setSendLoading(true);
    setSendError(null);
    setSendSuccess(null);
    try {
      const contract = getContract({
        client,
        chain: sepolia,
        address: smartAccountAddress as `0x${string}`,
      });
      // Call execute() as the admin EOA — msg.sender is checked against admin list.
      const tx = prepareContractCall({
        contract,
        method: "function execute(address _target, uint256 _value, bytes calldata _calldata)",
        params: [toAddress as `0x${string}`, toWei(amountEth), "0x"],
      });
      const receipt = await sendTransaction({ transaction: tx, account });
      setSendSuccess(
        `✓ 送金完了！\n` +
        `  TX: ${receipt.transactionHash}\n` +
        `  送金元 (Smart Account): ${smartAccountAddress}\n` +
        `  送金先               : ${toAddress}\n` +
        `  金額                 : ${amountEth} ETH`,
      );
      await fetchAdmins(smartAccountAddress);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "送金に失敗しました");
    } finally {
      setSendLoading(false);
    }
  };

  // ── Section A: fetch currently linked profiles ────────────────────────────
  const handleFetchProfiles = useCallback(async () => {
    setLinkLoading(true);
    setLinkError(null);
    try {
      const list = await getProfiles({ client });
      setProfiles(list);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "プロフィール取得に失敗しました");
    } finally {
      setLinkLoading(false);
    }
  }, []);

  // ── Section A: send SMS OTP for phone linking ─────────────────────────────
  // Must be called while an in-app wallet is already connected.
  const handleSendOtp = async (phoneNumber: string) => {
    setLinkLoading(true);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      await preAuthenticate({ client, strategy: "phone", phoneNumber });
      setOtpSent(true);
      setLinkSuccess(`OTP を ${phoneNumber} に送信しました`);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "OTP 送信に失敗しました");
    } finally {
      setLinkLoading(false);
    }
  };

  // ── Section A: link phone number to the connected wallet ─────────────────
  // linkProfile attaches a new auth method to the currently signed-in account.
  // After this call the user can log in with either Google OR phone OTP and
  // always arrive at the same wallet address.
  const handleLinkPhone = async (phoneNumber: string, verificationCode: string) => {
    setLinkLoading(true);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      const updated = await linkProfile({ client, strategy: "phone", phoneNumber, verificationCode });
      setProfiles(updated);
      setOtpSent(false);
      setLinkSuccess(
        `✓ 電話番号 ${phoneNumber} を紐付けました！\n` +
        `  Google または SMS OTP のどちらでログインしても同じアドレスに復旧できます。`
      );
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "電話番号の紐付けに失敗しました");
    } finally {
      setLinkLoading(false);
    }
  };

  // ── Section A: unlink a profile ───────────────────────────────────────────
  const handleUnlinkProfile = async (profile: LinkedProfile) => {
    setLinkLoading(true);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      const updated = await unlinkProfile({ client, profileToUnlink: profile });
      setProfiles(updated);
      setLinkSuccess(`✓ プロフィールを削除しました`);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "プロフィールの削除に失敗しました");
    } finally {
      setLinkLoading(false);
    }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const isAdminOf = (smartAcctAddress: string): boolean =>
    !!account &&
    !!smartAccount &&
    smartAccount.address.toLowerCase() === smartAcctAddress.toLowerCase() &&
    smartAccount.admins.some((a) => a.toLowerCase() === account.address.toLowerCase());

  return {
    // Section B state
    smartAccount,
    balance,
    fetchLoading,
    actionLoading,
    error,
    success,
    // Section A profile state
    profiles,
    otpSent,
    linkLoading,
    linkError,
    linkSuccess,
    // Shared wallet state
    account,
    activeWallet,
    // Section B actions
    fetchAdmins,
    handleGoogleLogin,
    handleGuardianGoogleLogin,
    handleWalletConnect,
    handleDisconnect,
    handleAddGuardian,
    handleRecover,
    handleSendFromEmployeeWallet,
    sendLoading,
    sendError,
    sendSuccess,
    isAdminOf,
    // Section A actions
    handleFetchProfiles,
    handleSendOtp,
    handleLinkPhone,
    handleUnlinkProfile,
    setOtpSent,
  };
}
