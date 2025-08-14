import {
  Smartphone,
  PlusCircle,
  ArrowRightLeft,
  FileSignature,
  FileClock,
  Tv2,
  MailPlus,
  Laptop,
} from "lucide-react";
import {
  type PerformanceData,
  type Target,
  type PerformanceMetricConfig,
  type PerformanceMetric,
  type Shop,
} from "@/lib/types";

export const SHOPS: Shop[] = [
  { 
    id: "shop1", 
    name: "Main Street", 
    description: "Our flagship store in the city center.", 
    salesRepresentatives: [
      {id: 'rep1', name: "Alice"}, 
      {id: 'rep2', name: "Bob"}
    ] 
  },
];

export const METRIC_CONFIG: PerformanceMetricConfig = {
  newSim: { label: "New SIM", icon: Smartphone },
  newLine: { label: "New Line", icon: PlusCircle },
  migrations: { label: "Migrations", icon: ArrowRightLeft },
  fixContractRenewal: { label: "Fix Contract Renewal", icon: FileSignature },
  mobileContractRenewal: {
    label: "Mobile Contract Renewal",
    icon: FileClock,
  },
  newTv: { label: "New TV", icon: Tv2 },
  newPostpaid: { label: "New Postpaid", icon: MailPlus },
  device: { label: "Device", icon: Laptop },
};

export const METRIC_WEIGHTS: Record<PerformanceMetric, number> = {
  newSim: 0.3,
  newLine: 0.25,
  migrations: 0.2,
  fixContractRenewal: 0.05,
  mobileContractRenewal: 0.05,
  newTv: 0.05,
  newPostpaid: 0.05,
  device: 0.05,
};


const initialTargets: Target = {
    newSim: 100,
    newLine: 120,
    migrations: 50,
    fixContractRenewal: 80,
    mobileContractRenewal: 90,
    newTv: 40,
    newPostpaid: 70,
    device: 60,
};

export const MONTHLY_TARGETS: Record<string, Target> = {
    "shop1": initialTargets
};


export const PERFORMANCE_DATA: Record<string, PerformanceData[]> = {
    "shop1": []
};
