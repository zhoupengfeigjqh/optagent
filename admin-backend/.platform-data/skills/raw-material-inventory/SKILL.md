---
name: raw-material-inventory
description: 原材料采购和库存本体技能，涵盖原材料、供应商、采购记录、库存等核心概念，支持采购单创建、取消、入库、库存查询、采购记录查询、原材料查询、供应商查询及供货能力查询等行为，并定义了从库存查询到采购入库的完整业务流程。
---

# 原材料采购和库存本体技能

## 0 本体基本信息
本体名称（ontology_name）: 原材料采购和库存
本体id（ontology_id）: 1
场景名称（scenario_name）: 生产调度
场景id（scenario_id）: 1

## 1概念与关系
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

- **原材料（RawMaterial）**：表示企业生产所需的各类原材料，包含原材料编号（rawMaterialId）、原材料名称（rawMaterialName）、单位（unit）和安全库存（safetyStock）等属性。
- **供应商（Supplier）**：表示为企业提供原材料的供应商主体，包含供应商编号（supplierId）、供应商名称（supplierName）、地址（address）、联系人（contactPerson）和联系电话（contactPhone）等属性。
- **原材料采购记录（PurchaseRecord）**：记录每一笔原材料采购的详细信息，包含采购记录编号（purchaseRecordId）、原材料编号（rawMaterialId）、原材料名称（rawMaterialName）、采购时间（purchaseTime）、到位时间（arrivalTime）、到位数量（arrivalQuantity）、单位（unit）、等待周期（leadTime）、供应商名称（supplierName）、关联订单编号（relatedOrderId）和关联订单名称（relatedOrderName）等属性。
- **原材料库存（RawMaterialInventory）**：表示原材料的库存快照信息，包含库存编号（inventoryId）、原材料编号（rawMaterialId）、原材料名称（rawMaterialName）、材料类型（materialType）、待入库量（pendingReceiptQuantity）、累计库存量（cumulativeStockQuantity）、可用库存（availableStock）和单位（unit）等属性。
- **客户订单（CustomerOrder）**：表示客户下达的生产订单，包含客户订单编号（customerOrderId）、客户订单名称（customerOrderName）、批次号（batchNumber）、缓冲期（bufferPeriod）、订单类型（orderType）和状态（status）等属性。
- **交货能力（DeliveryCapability）**：表示供应商对特定原材料的供货能力，包含原材料编号（rawMaterialId）、原材料名称（rawMaterialName）、供应商名称（supplierName）、供应商编号（supplierId）、交货周期（leadTime）和最小起订量（minCount）等属性。

概念之间的关系如下：
- **hasRawInventory（拥有库存）**：原材料（RawMaterial）与原材料库存（RawMaterialInventory）之间为1:1关系，即一种原材料对应一条库存记录。关系类型：functional、inverse_functional。
- **recordsRawMaterial（记录原材料）**：原材料采购记录（PurchaseRecord）与原材料（RawMaterial）之间为N:1关系，即多条采购记录可对应同一种原材料。关系类型：functional。
- **orderedFromSupplier（从...采购）**：原材料采购记录（PurchaseRecord）与供应商（Supplier）之间为N:1关系，即多条采购记录可对应同一供应商。关系类型：functional。
- **containsPurchaseRecord（包含采购记录）**：客户订单（CustomerOrder）与原材料采购记录（PurchaseRecord）之间为1:N关系，即一个客户订单可包含多条采购记录。关系类型：inverse_functional。
- **hasCapability（拥有供应能力）**：供应商（Supplier）与交货能力（DeliveryCapability）之间为1:N关系，即一个供应商可具备多种原材料的交货能力。关系类型：inverse_functional。
整个关系体系以原材料（RawMaterial）和供应商（Supplier）为核心，通过采购记录（PurchaseRecord）将客户订单（CustomerOrder）、库存（RawMaterialInventory）和交货能力（DeliveryCapability）串联起来，形成从客户需求、采购执行到库存管理的完整业务逻辑链条。

## 2重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

**原材料采购到入库（ProcureAndReceiveRawMaterial）** 是原材料库存和采购领域的核心业务流程，具体步骤如下：
1. **查询库存（QueryInventory）**：用户或系统查询原材料库存，判断是否需要采购。
2. **创建采购单（CreatePurchaseRecord）**：根据库存情况或客户订单需求，创建原材料采购单。
3. **查询采购记录（QueryPurchaseRecords）**：定期或主动按需查询采购记录，跟踪已创建的采购单状态。
4. **入库原材料（ReceiveRawMaterial）**：确认原材料到货，执行入库操作，更新库存。

## 3行为

### 3.1 CreatePurchaseRecord
- **类型**: command（命令）
- **行为描述**: 创建一笔新的原材料采购记录。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": true, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": true, "description": "", "example": "高强度钢板", "display_name": "原材料名称"},
  "arrivalQuantity": {"type": "number", "required": true, "description": "", "example": 50, "display_name": "到位数量"},
  "supplierName": {"type": "string", "required": true, "description": "", "example": "XX钢铁集团", "display_name": "供应商名称"},
  "arrivalTime": {"type": "string", "required": true, "description": "", "example": "2023-11-10", "display_name": "到位时间"},
  "relatedOrderId": {"type": "string", "required": false, "description": "", "example": "SO-20231025-001", "display_name": "关联订单编号"},
  "relatedOrderName": {"type": "string", "required": false, "description": "", "example": "客户A-项目X订单", "display_name": "关联订单名称"},
  "unit": {"type": "string", "required": true, "description": "", "example": "吨", "display_name": "单位"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
      "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
      "purchaseTime": {"type": "string", "display_name": "采购时间", "example": "2023-10-27"},
      "arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2023-11-10"},
      "arrivalQuantity": {"type": "number", "display_name": "到位数量", "example": 50},
      "unit": {"type": "string", "display_name": "单位", "example": "吨"},
      "supplierName": {"type": "string", "display_name": "供应商名称", "example": "XX钢铁集团"},
      "relatedOrderId": {"type": "string", "display_name": "关联订单编号", "example": "SO-20231025-001"},
      "relatedOrderName": {"type": "string", "display_name": "关联订单名称", "example": "客户A-项目X订单"},
      "leadTime": {"type": "number", "display_name": "等待周期", "example": 14},
      "status": {"type": "string", "display_name": "状态", "example": "待入库"}
    }
  }
}
```
- **相关概念**: 原材料（RawMaterial）、供应商（Supplier）、原材料采购记录（PurchaseRecord）、客户订单（CustomerOrder）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `CreatePurchaseRecord` 及其输入参数。

### 3.2 CancelPurchaseRecord
- **类型**: command（命令）
- **行为描述**: 取消一笔已创建但尚未入库的采购记录。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "required": true, "description": "", "example": "PO-20231027-001", "display_name": "采购单号"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "CRX001"},
      "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `CancelPurchaseRecord` 及其输入参数。

### 3.3 ReceiveRawMaterial
- **类型**: command（命令）
- **行为描述**: 将原材料采购入库。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "required": true, "description": "", "example": "PO-20231027-001", "display_name": "采购单号"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "CRX001"},
      "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料库存（RawMaterialInventory）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `ReceiveRawMaterial` 及其输入参数。

### 3.4 QueryInventory
- **类型**: query（查询）
- **行为描述**: 根据原材料ID或名称查询其最新的库存快照。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": false, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "高强度钢板", "display_name": "原材料名称"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "inventoryId": {"type": "string", "display_name": "库存编号", "example": "INV-RM-001"},
        "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "materialType": {"type": "string", "display_name": "材料类型", "example": "原材料"},
        "pendingReceiptQuantity": {"type": "number", "display_name": "待入库量", "example": 50},
        "cumulativeStockQuantity": {"type": "number", "display_name": "累计库存量", "example": 200},
        "availableStock": {"type": "number", "display_name": "可用库存", "example": 150},
        "unit": {"type": "string", "display_name": "单位", "example": "吨"}
      }
    }
  }
}
```
- **相关概念**: 原材料库存（RawMaterialInventory）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `QueryInventory` 及其输入参数。

### 3.5 QueryPurchaseRecords
- **类型**: query（查询）
- **行为描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "required": false, "description": "", "example": "PO-20231027-001", "display_name": "采购单号"},
  "rawMaterialId": {"type": "string", "required": false, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "高强度钢板", "display_name": "原材料名称"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
        "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "purchaseTime": {"type": "string", "display_name": "采购时间", "example": "2023-10-27"},
        "arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2023-11-10"},
        "arrivalQuantity": {"type": "number", "display_name": "到位数量", "example": 50},
        "unit": {"type": "string", "display_name": "单位", "example": "吨"},
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "XX钢铁集团"},
        "relatedOrderId": {"type": "string", "display_name": "关联订单编号", "example": "SO-20231025-001"},
        "relatedOrderName": {"type": "string", "display_name": "关联订单名称", "example": "客户A-项目X订单"},
        "leadTime": {"type": "number", "display_name": "等待周期", "example": 14}
      }
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）、供应商（Supplier）、客户订单（CustomerOrder）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `QueryPurchaseRecords` 及其输入参数。

### 3.6 QueryRawMaterials
- **类型**: query（查询）
- **行为描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": false, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "高强度钢板", "display_name": "原材料名称"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "unit": {"type": "string", "display_name": "单位", "example": "吨"},
        "safetyStock": {"type": "number", "display_name": "安全库存", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `QueryRawMaterials` 及其输入参数。

### 3.7 QuerySuppliers
- **类型**: query（查询）
- **行为描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "required": false, "description": "", "example": "宝钢钢铁集团", "display_name": "供应商名称，模糊匹配"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "钢板008", "display_name": "原材料名称"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "supplierId": {"type": "string", "display_name": "供应商编号", "example": "SUP-001"},
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"},
        "address": {"type": "string", "display_name": "地址", "example": "上海市宝山区富锦路888号"},
        "contactPerson": {"type": "string", "display_name": "联系人", "example": "张经理"},
        "contactPhone": {"type": "string", "display_name": "联系电话", "example": "13800131001"}
      }
    }
  }
}
```
- **相关概念**: 供应商（Supplier）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `QuerySuppliers` 及其输入参数。

### 3.8 QuerySupplierCapability
- **类型**: query（查询）
- **行为描述**: 根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "required": false, "description": "", "example": "宝钢钢铁集团", "display_name": "供应商名称"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "钢板008", "display_name": "原材料名称"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"},
        "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "leadTime": {"type": "number", "display_name": "交货周期", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 交货能力（DeliveryCapability）、供应商（Supplier）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——直接调用与行为同名的工具，参数为 `QuerySupplierCapability` 及其输入参数。
