import { ArrowDownLeft, ArrowUpRight, Bot, Repeat2 } from "lucide-react-native";

import type { WalletAction } from "@/types/wallet";

export const emptyWalletName = "Token Core Wallet";

export const walletActions: WalletAction[] = [
  {
    id: "send",
    icon: ArrowUpRight,
    label: "Send",
    tone: "default",
  },
  {
    id: "receive",
    icon: ArrowDownLeft,
    label: "Receive",
    tone: "receive",
  },
  {
    id: "swap",
    icon: Repeat2,
    label: "Swap",
    tone: "default",
  },
  {
    id: "agent-top-up",
    icon: Bot,
    label: "Agent",
    tone: "agent",
  },
];
