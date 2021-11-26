
# Alpaca Stablecoin

  

Solidity contracts for Alpaca Stablecoin module.

## System Interaction Diagram
![System_Interaction_Diagram](https://raw.githubusercontent.com/alpaca-finance/alpaca-stablecoin/chore/add-diagram-to-readme/docs/AlpacaUSD_SystemInteractionDiagram.jpg)

## High Level Diagram
![High_Level_Diagram](https://raw.githubusercontent.com/alpaca-finance/alpaca-stablecoin/chore/add-diagram-to-readme/docs/AlpacaUSD_HighLevelDiagram.png)

## System Architecture Diagram
![System_Architecture_Diagram](https://raw.githubusercontent.com/alpaca-finance/alpaca-stablecoin/chore/add-diagram-to-readme/docs/AlpacaUSD_SystemArchitecture.png)

## Testing and Development

  

### Dependencies

  

-  [nodejs](https://nodejs.org/en/) version 14 or greater

  

### Setup

  

To get started, clone the repo and install the developer dependencies:

  

```bash

git clone https://github.com/alpaca-finance/alpaca-stablecoin.git

cd alpaca-stablecoin

yarn install

```

  

### Running the Tests

  

```bash

yarn test

```

  

## Audits and Security

  

Alpaca Stablecoin contracts have been audited by [PeckShield](https://github.com/alpaca-finance/alpaca-stablecoin/blob/chore/add-audit-report/audits/PeckShield-Audit-Report-Alpaca-USD-v1.0.pdf) and [Inspex](https://github.com/alpaca-finance/alpaca-stablecoin/blob/chore/add-audit-report/audits/Inspex_AUDIT2021035_AlpacaFinance_AlpacaStablecoin_FullReport_v1.0.pdf).

  

This repository also included in our [bug bounty](https://immunefi.com/bounty/alpacafinance/) program on Immunefi for issues which can lead to substantial loss of money, critical bugs such as a broken live-ness condition, or irreversible loss of funds.

  

## License

  

The primary license for Alpaca Stablecoin project is the APGL 3.0 License, see [APGL 3.0 LICENSE](LICENSE).
