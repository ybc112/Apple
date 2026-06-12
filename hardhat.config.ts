import "dotenv/config";

import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatVerify],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    default: {
      type: "edr-simulated",
      chainType: "l1",
      blockGasLimit: 30_000_000,
      transactionGasCap: 30_000_000,
    },
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      blockGasLimit: 30_000_000,
      transactionGasCap: 30_000_000,
    },
    bsc: {
      type: "http",
      chainType: "l1",
      url: configVariable("BSC_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
  verify: {
    blockscout: {
      enabled: false,
    },
    etherscan: {
      apiKey: configVariable("BSCSCAN_API_KEY"),
    },
  },
});
