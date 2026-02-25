# Sage Accounting (South Africa) - Complete Feature Audit
> Audited: 2026-02-25 from live Velocity Fibre Pty Ltd account
> Subscription: Accounting | Financial Year End: 28/02/2026

---

## NAVIGATION STRUCTURE

### 1. HOME
| Feature | URL Path | Description |
|---------|----------|-------------|
| Dashboard | `/Dashboard/Home.aspx` | Overview widgets: To Do List, Banking, Sales History, Top Customers |
| Customer Dashboard | `/Dashboard/CustomerDashboard.aspx` | Customer-specific metrics |
| Supplier Dashboard | `/Dashboard/SupplierDashboard.aspx` | Supplier-specific metrics |
| Item Dashboard | `/Dashboard/ItemDashboard.aspx` | Item/inventory metrics |
| Financial Dashboard | `/Dashboard/FinancialDashboard.aspx` | Financial overview |
| My Workspace | `/Dashboard/MyWorkspace.aspx` | Quick action tiles (customisable) |

**Dashboard Widgets:** To Do List, Banking (account selector + chart), Sales History (bar chart), Top Customers by Sales

**Workspace Quick Actions:** Dashboard, Create a Quote, Create an Invoice, Customer Receipts, Create a Credit Note, Create a Supplier Invoice, Supplier Payments, Import Bank Statements, Record Expenses, View Bank Transactions, Send Customer Statements, Profit and Loss, Balance Sheet, Prepare your VAT Return, Change Company Settings

---

### 2. QUICK VIEW
| Feature | Description |
|---------|-------------|
| Customers | Quick customer overview |
| Suppliers | Quick supplier overview |
| Items | Quick item overview |
| Bank Accounts | Quick bank account overview |
| Accounts | Quick chart of accounts overview |

---

### 3. CUSTOMERS
#### 3.1 Add a Customer
- URL: `/Edit/CustomerEdit.aspx?BackToGrid=true`

#### 3.2 Lists
| Feature | URL Path |
|---------|----------|
| List of Customers | `/app#/customerMaintenance` |
| List of Sales Reps | `/app#/salesRepresentativeMaintenance` |
| Customer Categories | `/app#/categoryMaintenance/customer` |

#### 3.3 Transactions
| Feature | URL Path | Description |
|---------|----------|-------------|
| Customer Quotes | `/app#/quoteMaintenance` | Create/manage quotations |
| Customer Sales Orders | `/app#/salesOrderMaintenance` | Sales order processing |
| Customer Tax Invoices | `/app#/taxInvoiceMaintenance` | Tax invoice management |
| Customer Recurring Invoices | `/app#/recurringInvoiceMaintenance` | Auto-recurring invoices |
| Customer Credit Notes | `/app#/customerReturnMaintenance` | Returns/credits |
| Customer Receipts | `/app#/customerReceiptMaintenance` | Payment receipts |
| Allocate Receipts | `/Process/CustomerAllocationProcess.aspx` | Allocate payments to invoices |
| Customer Write-Offs | `/app#/customerWriteOffMaintenance` | Bad debt write-offs |
| Customer Adjustments | `/app#/customerAdjustmentMaintenance` | Balance adjustments |

#### 3.4 Reports
| Report | URL Path |
|--------|----------|
| Customer Statement Run | `/Wizards/CustomerStatementRun.aspx` |
| List of Customers | `/Reports/CustomerFilterOption.aspx?ReportViewType=0` |
| Sales by Customer | `/Reports/CustomerFilterOption.aspx?ReportViewType=1` |
| Sales by Sales Rep | `/Reports/SalesRepresentativeFilterOption.aspx?ReportViewType=45` |
| Customer Balances - Days Outstanding | `/Reports/HTMLReportFilter.aspx?ReportViewType=2` |
| Customer Statement | `/Reports/CustomerFilterOption.aspx?ReportViewType=3` |
| Customer Transactions | `/Reports/HTMLReportFilter.aspx?ReportViewType=4` |
| Customer Quotes | `/Reports/HTMLReportFilter.aspx?ReportViewType=57` |
| Customer Quotes by Customer | `/Reports/CustomerFilterOption.aspx?ReportViewType=53` |
| Customer Sales Orders | `/Reports/HTMLReportFilter.aspx?ReportViewType=109` |
| Customer Sales Orders by Customer | `/Reports/HTMLReportFilter.aspx?ReportViewType=111` |
| Customer Invoices | `/Reports/HTMLReportFilter.aspx?ReportViewType=42` |
| Customer Unallocated Receipts | `/Reports/HTMLReportFilter.aspx?ReportViewType=67` |
| Customer Communication Report | `/Reports/OtherFilterOption.aspx?ReportViewType=41` |

#### 3.5 Special
| Feature | URL Path |
|---------|----------|
| Adjust Opening Balances | `/Wizards/AdjustCustomerOpeningBalance.aspx` |

#### 3.6 Time Tracking (Add-on Module)
- URL: `/Admin/ModuleLicenseRequired.aspx?Module=1`

#### 3.7 Debtors Manager (Add-on Module)
| Feature | Description |
|---------|-------------|
| Invoices Manager | Outstanding invoice tracking |
| Outstanding Invoices Communication Run | Bulk comms for overdue invoices |
| Outstanding Invoices Workflow | Automated collections workflow |
| Customer Non Payment Reasons | Reason codes for non-payment |
| Outstanding Invoices Action Codes | Action tracking codes |

---

### 4. SUPPLIERS
#### 4.1 Add a Supplier
- URL: `/Edit/SupplierEdit.aspx?BackToGrid=true`

#### 4.2 Lists
| Feature | URL Path |
|---------|----------|
| List of Suppliers | `/app#/supplierMaintenance` |
| Supplier Categories | `/app#/categoryMaintenance/supplier` |

#### 4.3 Transactions
| Feature | URL Path | Description |
|---------|----------|-------------|
| Supplier Purchase Orders | `/app#/purchaseOrderMaintenance` | PO creation/management |
| Supplier Invoices | `/app#/supplierInvoiceMaintenance` | Supplier invoice capture |
| Supplier Returns | `/app#/supplierReturnMaintenance` | Returns to suppliers |
| Supplier Payments | `/app#/supplierPaymentMaintenance` | Payment processing |
| Supplier Batch Payments | `/app#/externalSupplierPayment` | Bulk payment processing |
| Allocate Payments | `/Process/SupplierAllocationProcess.aspx` | Allocate payments to invoices |
| Supplier Adjustments | `/app#/supplierAdjustmentMaintenance` | Balance adjustments |

#### 4.4 Reports
| Report | URL Path |
|--------|----------|
| List of Suppliers | `/Reports/SupplierFilterOption.aspx?ReportViewType=5` |
| Purchases by Supplier | `/Reports/SupplierFilterOption.aspx?ReportViewType=6` |
| Supplier Balances - Days Outstanding | `/Reports/HTMLReportFilter.aspx?ReportViewType=8` |
| Supplier Statement | `/Reports/SupplierFilterOption.aspx?ReportViewType=7` |
| Supplier Transactions | `/Reports/HTMLReportFilter.aspx?ReportViewType=9` |
| Supplier Purchase Orders | `/Reports/HTMLReportFilter.aspx?ReportViewType=58` |
| Supplier Purchase Orders by Supplier | `/Reports/SupplierFilterOption.aspx?ReportViewType=56` |
| Supplier Invoices | `/Reports/HTMLReportFilter.aspx?ReportViewType=43` |
| Supplier Unallocated Payments | `/Reports/HTMLReportFilter.aspx?ReportViewType=68` |
| Emails Sent to Suppliers | `/Reports/OtherFilterOption.aspx?ReportViewType=61` |

#### 4.5 Special
| Feature | URL Path |
|---------|----------|
| Adjust Opening Balances | `/Wizards/AdjustSupplierOpeningBalance.aspx` |

---

### 5. ITEMS
#### 5.1 Add an Item
- URL: `/Edit/ItemEdit.aspx?BackToGrid=true`

#### 5.2 Lists
| Feature | URL Path |
|---------|----------|
| List of Items | `/app#/itemMaintenance` |
| List of Item Bundles | `/app#/itemBundleMaintenance` |
| Item Categories | `/app#/categoryMaintenance/item` |

#### 5.3 Transactions
| Feature | URL Path |
|---------|----------|
| Item Adjustments | `/Wizards/AdjustItem.aspx` |
| Adjust Item Selling Prices | `/Wizards/AdjustItemSellingPrice.aspx` |

#### 5.4 Special
| Feature | URL Path |
|---------|----------|
| Adjust Item Opening Balances | `/Wizards/AdjustItemOpeningBalance.aspx` |
| Renumber Item Codes | `/Maintenance/ItemCodeMaintenance.aspx` |

#### 5.5 Reports
| Report | URL Path |
|--------|----------|
| Item Listing | `/Reports/HTMLReportFilter.aspx?ReportViewType=10` |
| Sales by Item | `/Reports/HTMLReportFilter.aspx?ReportViewType=11` |
| Purchases by Item | `/Reports/HTMLReportFilter.aspx?ReportViewType=12` |
| Customer Quotes by Item | `/Reports/QuoteFilterOption.aspx?ReportViewType=52` |
| Customer Sales Orders by Item | `/Reports/HTMLReportFilter.aspx?ReportViewType=110` |
| Supplier Purchase Orders by Item | `/Reports/ItemFilterOption.aspx?ReportViewType=55` |
| Item Movement | `/Reports/ItemFilterOption.aspx?ReportViewType=13` |
| Item Valuation | `/Reports/HTMLReportFilter.aspx?ReportViewType=14` |
| Price List | `/Reports/HTMLReportFilter.aspx?ReportViewType=62` |
| Item Bundle | `/Reports/HTMLReportFilter.aspx?ReportViewType=107` |
| Item Quantities | `/Reports/HTMLReportFilter.aspx?ReportViewType=108` |

---

### 6. BANKING
#### 6.1 Add a Bank or Credit Card
- URL: `/Edit/BankAccountEdit.aspx?BackToGrid=true`

#### 6.2 Lists
| Feature | URL Path |
|---------|----------|
| List of Banks and Credit Cards | `/app#/bankAccountMaintenance` |
| Bank and Credit Card Categories | `/app#/categoryMaintenance/bankaccount` |
| Quick Entry Rules | `/app#/quickEntryRules` |
| Bank Statement Mapping Rules | `/app#/bankStatementMappingRules` |

#### 6.3 Transactions
| Feature | URL Path | Description |
|---------|----------|-------------|
| Banking | `/app#/banking` | Main banking transaction view |
| Reconcile Banks and Credit Cards | `/Process/BankReconciliationProcess.aspx` | Bank reconciliation |
| Manage Bank Feeds | `/BankFeeds/AutomaticBankFeedManage.aspx` | Automatic bank feed integration |

#### 6.4 Reports
| Report | URL Path |
|--------|----------|
| List of Banks and Credit Cards | `/Reports/OtherFilterOption.aspx?ReportViewType=16` |
| Banks and Credit Cards Transactions | `/Reports/HTMLReportFilter.aspx?ReportViewType=17` |
| Cash Movement | `/Reports/OtherFilterOption.aspx?ReportViewType=18` |
| Cash Flow | `/Reports/HTMLReportFilter.aspx?ReportViewType=38` |
| Bank Feeds Audit Trail | `/Reports/HTMLReportFilter.aspx?ReportViewType=59` |

#### 6.5 Special
| Feature | URL Path |
|---------|----------|
| Adjust Bank and Credit Card Opening Balances | `/Wizards/AdjustBankAccountOpeningBalance.aspx` |

---

### 7. ACCOUNTS (Chart of Accounts)
#### 7.1 Add an Account
- URL: `/Edit/AccountEdit.aspx?BackToGrid=true`

#### 7.2 Lists
| Feature | URL Path |
|---------|----------|
| List of Accounts | `/app#/accountMaintenance` |
| Item Accounts | `/app#/itemReportGroupMaintenance` |
| Account Reporting Groups | `/Maintenance/ReportingGroupMaintenance.aspx` |
| Adjust Account Opening Balances | `/Wizards/AdjustAccountOpeningBalance.aspx` |

#### 7.3 Reports
| Report | URL Path |
|--------|----------|
| Account Listing | `/Reports/OtherFilterOption.aspx?ReportViewType=29` |
| Account Transactions | `/Reports/HTMLReportFilter.aspx?ReportViewType=22` |

---

### 8. ACCOUNTANT'S AREA
| Feature | URL Path | Description |
|---------|----------|-------------|
| Send a Note To My Accountant | (modal) | Communication with accountant |
| Process Journal Entries | `/app#/journalProcess` | Manual journal entries |
| Recurring Journal Entries | `/app#/recurringJournalMaintenance` | Automated recurring journals |

#### 8.1 VAT
| Feature | URL Path |
|---------|----------|
| VAT Returns and Reports | `/Maintenance/TaxPeriodMaintenance.aspx` |
| VAT Adjustments | `/app#/taxAdjustment` |
| VAT Payments and Refunds | `/Wizards/TaxPaymentsAndRefunds.aspx` |
| DRC VAT Allocations | `/app#/domesticReverseChargesAllocation` |
| DRC VAT Statements | `/app#/domesticReverseChargeStatements` |

#### 8.2 Reports > Management Reports
| Report | URL Path |
|--------|----------|
| Profit and Loss | `/Reports/HTMLReportFilter.aspx?ReportViewType=40` |
| Balance Sheet | `/Reports/HTMLReportFilter.aspx?ReportViewType=49` |
| Trial Balance | `/Reports/HTMLReportFilter.aspx?ReportViewType=32` |
| Budget Report | `/Reports/HTMLReportFilter.aspx?ReportViewType=44` |

#### 8.3 Reports > Transaction Reports
| Report | URL Path |
|--------|----------|
| Journal Entries Report | `/Reports/OtherFilterOption.aspx?ReportViewType=47` |

#### 8.4 Reports > Audit Reports
| Report | URL Path |
|--------|----------|
| Opening Balances and VAT Adjustments | `/Reports/HTMLReportFilter.aspx?ReportViewType=34` |
| Audit Trail | `/Reports/OtherFilterOption.aspx?ReportViewType=26` |
| System Audit Trail | `/Reports/OtherFilterOption.aspx?ReportViewType=50` |

#### 8.5 Trial Balance Export
- URL: `/Wizards/TrialBalanceExport.aspx`

---

### 9. REPORTS (Centralised)
| Report Category | URL Path |
|----------------|----------|
| Accounting Intelligence Reporting | (modal/dashboard) |
| Customers | `/Reports/CustomerReports.aspx` |
| Suppliers | `/Reports/SupplierReports.aspx` |
| Items | `/Reports/ItemReports.aspx` |
| Sales and Purchases | `/Reports/SalesAndPurchasesReports.aspx` |
| Banks and Credit Cards | `/Reports/BankAndCreditCardReports.aspx` |
| VAT | `/Maintenance/TaxPeriodMaintenance.aspx` |
| Accounts | `/Reports/AccountReports.aspx` |
| Financial Statements | `/Reports/FinancialStatementReports.aspx` |
| Asset Report | `/Reports/OtherFilterOption.aspx?ReportViewType=15` |
| Budget Report | `/Reports/HTMLReportFilter.aspx?ReportViewType=44` |
| Other | `/Reports/OtherReports.aspx` |
| Accountants Reports | `/Reports/AccountantsReports.aspx` |
| Time Tracking | (Add-on Module) |
| Debtors Manager | (Add-on Module) |

---

### 10. COMPANY
| Feature | URL Path | Description |
|---------|----------|-------------|
| Open and Manage Companies | `/Maintenance/OpenAndManageCompanyMaintenance.aspx` | Multi-company management |
| Change Company Settings | `/Edit/CompanyEdit.aspx?CurrentCompany=true` | Branding, financial years, VAT |
| Company Notes and Attachments | (modal) | File attachments |

#### 10.1 Assets
| Feature | URL Path |
|---------|----------|
| Add an Asset | `/Edit/AssetEdit.aspx?BackToGrid=true` |
| List of Assets | `/app#/assetMaintenance` |
| Asset Categories | `/app#/categoryMaintenance/asset` |
| Asset Locations | `/app#/categoryMaintenance/assetlocation` |
| Asset Report | `/Reports/OtherFilterOption.aspx?ReportViewType=15` |

#### 10.2 Budgets
| Feature | URL Path |
|---------|----------|
| Add a Budget | `/Wizards/BudgetSetupWizard.aspx` |
| List of Budgets | `/app#/budgetMaintenance` |
| Budget Report | `/Reports/HTMLReportFilter.aspx?ReportViewType=44` |

#### 10.3 User Task Management
| Feature | URL Path |
|---------|----------|
| User Task Dashboard | `/app#/utm/dashboard` |
| User Task Categories | `/app#/categoryMaintenance/usertask` |

#### 10.4 Data Management
| Feature | URL Path | Description |
|---------|----------|-------------|
| Analysis Codes | `/Maintenance/AnalysisCodeMaintenance.aspx` | Custom analysis dimensions |
| Import Data | `/Wizards/ImportCSVData.aspx` | CSV data import |
| Export Data | `/Wizards/ExportCSVData.aspx` | CSV data export |
| Convert From Other Applications | `/Wizards/PartnerCompanyConversionWizard.aspx` | Migration tool |
| Opening Balances | `/Wizards/TakeOnBalanceWizard.aspx` | Initial balance setup |

---

### 11. ADMINISTRATION
| Feature | URL Path | Description |
|---------|----------|-------------|
| Control User Access | `/Edit/UserCompanyAccess.aspx` | Role-based access control |
| Change Password | `/Admin/ChangePassword.aspx` | Password management |
| My Account | `/app#/myAccount` | Account settings |
| Logout | `/Logout.aspx` | Sign out |

---

### 12. AUTOENTRY (Integration)
| Feature | Description |
|---------|-------------|
| Try for Free | AutoEntry document scanning trial |
| Login to AutoEntry | SSO into AutoEntry |

---

### 13. OTHER
| Feature | URL Path |
|---------|----------|
| Search transactions | Global transaction search bar |
| Information Centre | Notifications/alerts |
| Manage Favourites | `/Admin/ManageFavourites.aspx` |
| Add Current Page (to favourites) | Bookmark current page |

---

## FORM/FIELD DETAIL

### Customer Form (`/Edit/CustomerEdit.aspx`)
**Header Fields:**
| Field | Type | Notes |
|-------|------|-------|
| Customer Name | text | Required |
| Category | dropdown | User-defined categories |
| Cash Sale Customer | checkbox | |
| Opening Balance | currency | R 0.00 |
| Opening Balance as At | date | |
| Active | checkbox | Default: checked |
| Credit Limit | currency | R 0.00 |
| Customer VAT Number | text | |
| Sales Rep | dropdown | From Sales Reps list |
| Accepts Electronic Invoices | checkbox | |
| Auto Allocate Receipts to Oldest Invoice | checkbox | |

**Tabs:** Details | Activity | Additional Contacts | Notes | User Defined Fields | Personal Information | Sales Graph | Quotes

**Details Tab:**
- **Postal Address** - 4 lines + Postal Code
- **Delivery Address** - Dropdown selector + 4 lines + Postal Code (Copy from Postal Address | Map)
- **Contact Details** - Contact Name, Email, Telephone, Mobile, Fax, Web Address
- **Invoices can be viewed online** - checkbox
- **Default Settings:**
  - Statement Distribution (dropdown: Email/Print/None)
  - Default Discount (percentage)
  - Default Price List (text)
  - Default VAT Type (dropdown)
  - Due Date for Payment (days + period: End of current Month / Days after invoice date / etc.)
  - Subject to DRC VAT (checkbox)

---

### Supplier Form (`/Edit/SupplierEdit.aspx`)
**Header Fields:**
| Field | Type | Notes |
|-------|------|-------|
| Supplier Name | text | Required |
| Category | dropdown | User-defined categories |
| Opening Balance | currency | R 0.00 |
| Opening Balance as At | date | |
| Active | checkbox | Default: checked |
| Credit Limit | currency | R 0.00 |
| VAT Reference | text | |
| Auto Allocate Payments to Oldest Invoice | checkbox | |

**Tabs:** Details | Activity | Additional Contacts | Banking Details | Notes | User Defined Fields | Personal Information | Purchases Graph

**Details Tab:**
- **Postal Address** - 4 lines + Postal Code
- **Physical Address** - Dropdown selector + 4 lines + Postal Code (Copy from Postal Address | Map)
- **Contact Details** - Contact Name, Email, Telephone, Mobile, Fax, Web Address
- **Default Settings:**
  - Default Discount (percentage)
  - Default VAT Type (dropdown)
  - Due Date for Payment (days + period)
  - Subject to DRC VAT (checkbox)

---

### Item Form (`/Edit/ItemEdit.aspx`)
**Header Fields:**
| Field | Type | Notes |
|-------|------|-------|
| Code | text | Item code (e.g., IN1008) |
| Description | text | |
| Category | dropdown | User-defined categories |
| Item Type | radio | Physical / Service |
| Active | checkbox | Default: checked |
| Opening Cost | currency | R 0.00 |
| Opening Quantity | number | 0 |
| Opening Quantity as At | date | |

**Tabs:** Details | Price Lists | Activity | Notes | User Defined Fields | Purchases Graph | Sales Graph | Sales vs Purchases Graph | Picture

**Details Tab - Item Details:**
| Field | Type | Notes |
|-------|------|-------|
| Exclusive Selling Price | currency | Per price list |
| Inclusive Selling Price | currency | Auto-calculated |
| Unit | text | e.g., each, metre, hour |
| GP % | percentage | Gross profit margin |
| GP Amount | currency | Gross profit amount |
| VAT On Sales | dropdown | Standard Rate (15.00%) |
| VAT On Purchases | dropdown | Standard Rate (15.00%) |

**Details Tab - Item Accounts:**
| Field | Type | Notes |
|-------|------|-------|
| Sales Account | dropdown | Links to Chart of Accounts |
| Purchases Account | dropdown | Links to Chart of Accounts |

---

### Tax Invoice Form (`/Process/TaxInvoiceProcess.aspx`)
**Actions:** Send (dropdown) | Options (dropdown)

**Customer Details:**
| Field | Type | Notes |
|-------|------|-------|
| Customer | dropdown | Customer selector |
| Balance | currency | Auto-populated |
| VAT Reference | text | Auto-populated from customer |
| Credit Limit | currency | Auto-populated |
| Delivery Address | multi-line | 5 lines |
| Postal Address | multi-line | 5 lines |

**Invoice Details:**
| Field | Type | Notes |
|-------|------|-------|
| Document No. | text | Auto-generated (*NUMBER*) |
| Customer Ref. | text | |
| From Quote / Sales Order | dropdown | Link to existing quote/SO |
| Layout | dropdown | Default (Modern) |
| Sales Rep | dropdown | |
| Date | date | |
| Due Date | date | |
| Discount % | percentage | |
| Use Inclusive Amounts | checkbox | |

**Line Items Grid:**
| Column | Description |
|--------|-------------|
| Type | Item / Account |
| Selection | Select Item link |
| Description | Line description |
| Unit | Unit of measure |
| Qty | Quantity |
| Excl. Price | Exclusive price |
| VAT Type | VAT rate selector |
| Disc % | Line discount |
| Discount | Discount amount |
| Exclusive | Exclusive total |
| VAT | VAT amount |
| Total | Line total |

**Footer:**
- Message (text area with bank details)
- Set Default Message link
- Total Discount / Total Exclusive / Total VAT / Total
- **Status:** New Tax Invoice
- **Actions:** Save | Save and New | Print Preview | Email | Print Delivery Note

---

### Quote Form (`/Process/QuoteProcess.aspx`)
Same structure as Tax Invoice except:
- **Expiry Date** instead of Due Date
- No "From Quote / Sales Order" field
- **Status:** New Quote

---

### Supplier Invoice Form (`/Process/SupplierInvoiceProcess.aspx`)
**Supplier Details:**
| Field | Type | Notes |
|-------|------|-------|
| Supplier | dropdown | Supplier selector |
| Balance | currency | Auto-populated |
| VAT Reference | text | |
| Credit Limit | currency | |
| Physical Address | multi-line | |
| Postal Address | multi-line | |

**Invoice Details:**
| Field | Type | Notes |
|-------|------|-------|
| Document No. | text | Auto-generated |
| Supplier Inv. No. | text | Supplier's invoice number |
| From Purchase Order | dropdown | Link to existing PO |
| Layout | dropdown | |
| Date | date | |
| Due Date | date | |
| Discount % | percentage | |
| Use Inclusive Amounts | checkbox | |

**Line Items:** Same grid as Tax Invoice
**Extra:** "Add Additional Costs" link
**Actions:** Save | Save and New | Print Preview | Email

---

### Journal Entry Form (`/app#/journalProcess`)
**Tabs:** New Journals | Reviewed Journals

**Actions:** Mark as Reviewed | Delete | Batch Edit | Schedule Recurring Journal | Import Journals | Export

**Line Item Columns:**
| Column | Description |
|--------|-------------|
| Date | Transaction date |
| Effect | Debit / Credit |
| Account | Account selector (from Chart of Accounts) |
| Reference | Reference text |
| Description | Description |
| VAT Type | No VAT / Standard Rate / etc. |
| Amount | Exclusive amount |
| VAT | VAT amount |
| Incl. VAT | Inclusive amount |
| by Affecting Acc. | Affecting account |

**Workflow:** New Journals (drafts) → Mark as Reviewed → Only reviewed journals update balances

---

### Banking Transaction View (`/app#/banking`)
**Header:** Bank/Credit Card selector | Bank Balance | Transaction count "To be Reviewed"

**Tabs:** New Transactions | Reviewed Transactions

**Actions:** Mark as Reviewed | Delete | Keep Duplicates | Batch Edit | Import Bank Statements | Export

**Transaction Columns:**
| Column | Description |
|--------|-------------|
| Date | Transaction date |
| Payee | Payee name (editable) |
| Description | Bank statement description |
| Type | Account / Supplier / Customer |
| Selection | Account/entity selector (e.g., "Unallocated Income", supplier name) |
| Reference | Reference number |
| VAT | VAT type |
| Spent | Debit amount |
| Received | Credit amount |
| Rec. | Reconciled checkbox |

**Actions per row:** Accept | Edit | Split | Duplicate | Add | Remove

---

### Account (Chart of Accounts) Form (`/Edit/AccountEdit.aspx`)
| Field | Type | Notes |
|-------|------|-------|
| Account Name | text | Required |
| Category | dropdown | See Reporting Group Categories below |
| Active | checkbox | Default: checked |
| Opening Balance | currency | R 0.00 |
| Opening Balance as At | date | |
| Default VAT Type | dropdown | |
| Description | textarea | |

**Tabs:** Activity | Notes

---

### Asset Form (`/Edit/AssetEdit.aspx`)
| Field | Type | Notes |
|-------|------|-------|
| Description | text | Required |
| Category | dropdown | Asset categories |
| Location | dropdown | Asset locations |
| Date Purchased | date | |
| Serial Number | text | |
| Bought From | text | |
| Purchase Price | currency | |
| Replacement Value | currency | |
| Current Value | currency | |

**Tabs:** User Defined Fields | Notes

**User Defined Fields (12 fields):**
- Text Field 1-3
- Numeric Field 1-3
- Yes/No Field 1-3
- Date Field 1-3

---

### Company Settings (`/Edit/CompanyEdit.aspx`)
**Sections:**

#### Company Details
- Company Details: Company Name, Email, Telephone, Fax, Mobile, Contact Name, CC email
- Email options: Use this Email for Communication, Use Sage as From Address, Always CC
- Postal Address (4 lines + Postal Code)
- Physical Address (4 lines)
- Additional Company Information
- Customer Zone
- Online Payment Gateways
- Netcash integration

#### General Settings
- Financial Years
- Rounding
- Regional Settings
- Customer and Supplier Settings
- Item Settings
- Outstanding Balances
- Personal Information

#### VAT Settings
- VAT configuration for SA compliance

#### Documents and Statements
- Document layout/template settings

#### Branding
- Logo, colours, document branding

#### User Defined Fields
- Custom fields configuration

#### Email Signatures
- Email signature templates

#### Multi-Currency
- Foreign currency support settings

---

### User Access Control (`/Edit/UserCompanyAccess.aspx`)
- Company selector grid
- Invited users list (drag to assign)
- Users with access list (with per-user permissions link)
- Per-user role-based permissions

**Current Users (Velocity Fibre):**
- Carla Jooste, Salome Miller, Melanie Odendaal, Hanro Oosthuizen, Hein van Vuuren

---

## CHART OF ACCOUNTS - REPORTING GROUP CATEGORIES

### Income Statement Categories
| Category | Type | Description |
|----------|------|-------------|
| **Sales** | Revenue | Sales income accounts |
| **Cost of Sales** | COGS | Direct costs of revenue |
| **Other Income** | Revenue | Non-operating income |
| **Expenses** | Expense | Operating expenses |
| **Income Tax** | Tax | Income tax provision |

### Balance Sheet Categories
| Category | Type | Description |
|----------|------|-------------|
| **Non-Current Assets** | Asset | Fixed assets, accumulated depreciation |
| **Current Assets** | Asset | Bank accounts, debtors, inventory, deposits |
| **Non-Current Liabilities** | Liability | Bank loans |
| **Current Liabilities** | Liability | Trade creditors, VAT, short-term loans |
| **Owners Equity** | Equity | Retained income, P&L, opening balances |

### Full Account List (166 accounts in Velocity Fibre)

**Sales (5):** Contra charges, Contract Revenue, Other Income, Sales, Sales - Time

**Cost of Sales (10):** COS - Casual wages, COS - Fleet - Fuel & Diesel, COS - Sub-Contractors, COS - Wayleave Cost, Cost of Sales - Direct Material, Cost of Sales / Purchases, Cost of Sales / Purchases - Services, Item Adjustments, Purchases

**Other Income (4):** Bad Debts Recovered, Discount Received, Interest Received, Unallocated Income

**Expenses (50+):** Advertising & Marketing, Assets under R7,500, Audit & Accounting Fees, Bad Debts, Bank Charges, Business Development, Cleaning, Commission, Computer Expenses, Consultancy Fees, Customer Document Rounding, Depreciation (3 types), Discount Allowed, Electricity & Water, Entertainment, Fines & Penalties, Forex Gains/Losses (3 types), General Expenses, Health & Safety, Insurance, Interest Paid (4 types), Legal Expenses, Licences & Registration, Management Fees, Motor Vehicle Expenses (2 types), Postage & Courier, Printing & Stationery, Rent (3 types), Repairs & Maintenance (2 types), Salaries & Wages (2 types), Security, Small Tools & Equipment, Staff Welfare, Subscriptions, Telephones, Travelling & Accommodation (3 types), Unallocated Expense

**Income Tax (1):** Income Tax

**Non-Current Assets (9):** Accumulated Depreciation (3 types), Cost (3 types), Fixed Assets (3 types)

**Current Assets (60+):** ABSA Petty Cards (20+), Bank Transfer Accounts, Cash on hand, Deposits, Inventory, Loans receivable, Paycard accounts (20+), Staff advances/loans, Trade Debtors/Receivables, Bank accounts (ABSA, STD)

**Non-Current Liabilities (1):** Bank Loans

**Current Liabilities (15+):** DRC VAT Payable, Income Tax Payable, Income received in advance, Loans payable (6+), Prepayments, Trade Creditors/Payables, VAT (3 types)

**Owners Equity (4):** Opening Balance and VAT Adjustments, Profit and Loss (This Year), Retained Income, System Rounding

---

## FEATURE SUMMARY FOR FIBREFLOW ALIGNMENT

### Core Modules in Sage
1. **Customers** - Full CRM with quotes, sales orders, invoices, receipts, credit notes, write-offs, adjustments, recurring invoices, statement runs
2. **Suppliers** - Purchase orders, invoices, returns, payments, batch payments, adjustments
3. **Items** - Inventory with bundles, categories, adjustments, price management, valuations
4. **Banking** - Bank accounts, credit cards, feeds, reconciliation, quick entry rules, statement mapping
5. **Accounts** - Chart of accounts, reporting groups, item accounts
6. **Accountant's Area** - Journal entries, VAT management (returns, adjustments, payments, DRC), financial statements
7. **Reports** - 50+ report types across all modules
8. **Company** - Multi-company, assets, budgets, user tasks, analysis codes, data import/export
9. **Administration** - User access control, password management

### Document Flow (Sage)
```
Quote → Sales Order → Tax Invoice → Receipt
                                   → Credit Note
                                   → Write-Off

Purchase Order → Supplier Invoice → Payment
                                  → Return
                                  → Adjustment
```

### Key Sage Concepts to Mirror
- **Categories** for Customers, Suppliers, Items, Banks, Assets, User Tasks
- **Analysis Codes** - Custom dimensions for reporting
- **Reporting Groups** - Account grouping for financial statements
- **Bank Statement Mapping Rules** - Auto-categorisation of bank transactions
- **Quick Entry Rules** - Shortcut rules for common banking entries
- **Recurring Invoices/Journals** - Automated scheduled transactions
- **Batch Payments** - Bulk supplier payment processing
- **Bank Feeds** - Automatic bank statement import
- **VAT/DRC** - Full SA VAT compliance including Domestic Reverse Charge
