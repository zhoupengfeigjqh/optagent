---
name: raw-material-inventory
description: 包括原材料、库存、采购单和供应商的相关技能
metadata:
  ontology_id: '1'
  ontology_name: 原材料采购和库存
  scenario_id: '1'
  scenario_name: 生产调度
---

# 原材料库存和采购本体技能

## 0 本体基本信息
本体名称（ontology_name）: 原材料采购和库存
本体id（ontology_id）: 1
场景名称（scenario_name）: 生产调度
场景id（scenario_id）: 1

## 1 概念详情
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

| 概念名 | 展示名称 | 概念描述 | 术语集 |
|---|---|---|---|
| RawMaterial | 原材料 | 生产过程中消耗的外部输入物料，是采购和库存管理的核心对象。 | 物料；原料 |
| Supplier | 供应商 | 原材料的供应方，可以供应一种或多种原材料。 | 供货商 |
| PurchaseRecord | 原材料采购记录 | 一次具体的原材料采购行为，关联了采购的原材料、供应商以及驱动采购的客户订单。 | 采购单；采购记录 |
| RawMaterialInventory | 原材料库存 | 特定原材料在当前时刻的库存状态快照，包括待入库、可用和累计库存量。 | 库存；库存快照 |
| CustomerOrder | 客户订单 | 客户下达的销售订单或询单，是驱动原材料采购的源头需求。 | 客单；销售订单 |
| DeliveryCapability | 交货能力 | 供应商的交货能力，包括交货周期、最低交货数量等 | 供货能力；供应能力 |

## 2 概念间的关系

| 关系名 | 展示名称 | 源概念 → 目标概念 | 基数 | 关联字段 | 关系说明 |
|---|---|---|---|---|---|
| HasRawInventory | 拥有库存 | RawMaterial → RawMaterialInventory | 1:1 | RawMaterial.rawMaterialId = RawMaterialInventory.rawMaterialId | 每个原材料有且仅有一条对应的最新库存快照。 |
| RecordsRawMaterial | 记录原材料 | PurchaseRecord → RawMaterial | N:1 | PurchaseRecord.rawMaterialId = RawMaterial.rawMaterialId | 多个采购记录可以指向同一种原材料，但一个采购记录只采购一种原材料。 |
| OrderedFromSupplier | 从...采购 | PurchaseRecord → Supplier | N:1 | PurchaseRecord.supplierName = Supplier.supplierName | 多个采购记录可以从同一个供应商采购，但一个采购记录只对应一个供应商。 |
| ContainsPurchaseRecord | 包含采购记录 | CustomerOrder → PurchaseRecord | 1:N | CustomerOrder.customerOrderId = PurchaseRecord.relatedOrderId | 一个客户订单可以包含多个采购记录，但一个采购记录最多只能关联一个客户订单。 |
| HasCapability | 拥有供应能力 | Supplier → DeliveryCapability | 1:N | Supplier.supplierId = DeliveryCapability.supplierId | 一个供应商可以包含多个原材料的供应能力，但一个交货能力只对应一个供应商 |

关系体系以原材料（RawMaterial）为核心：原材料通过 HasRawInventory 关联其唯一的库存快照（RawMaterialInventory），通过 RecordsRawMaterial 被多条采购记录（PurchaseRecord）引用；采购记录通过 OrderedFromSupplier 指向供应商（Supplier），并通过 ContainsPurchaseRecord 由客户订单（CustomerOrder）驱动；供应商通过 HasCapability 拥有多条交货能力（DeliveryCapability）。由此形成「客户订单 → 采购记录 → 原材料/供应商 → 库存」的完整业务逻辑链条。

## 3 概念属性及约束

**原材料（RawMaterial）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| rawMaterialId | 原材料编号 | string | 唯一；必填 |
| rawMaterialName | 原材料名称 | string | 必填 |
| unit | 单位 | string | 必填 |
| safetyStock | 安全库存 | number | - |
| status | 状态 | string | 必填；枚举=[有效, 无效] |

**供应商（Supplier）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| supplierId | 供应商编号 | string | 唯一；必填 |
| supplierName | 供应商名称 | string | 唯一；必填 |
| address | 地址 | string | - |
| contactPerson | 联系人 | string | - |
| contactPhone | 联系电话 | string | - |

**原材料采购记录（PurchaseRecord）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| purchaseRecordId | 采购单号 | string | 唯一；必填 |
| rawMaterialId | 原材料编号 | string | - |
| rawMaterialName | 原材料名称 | string | - |
| purchaseTime | 采购时间 | string | - |
| arrivalTime | 到位时间 | string | - |
| arrivalQuantity | 到位数量 | number | - |
| unit | 单位 | string | - |
| leadTime | 等待周期 | number | - |
| supplierName | 供应商名称 | string | - |
| relatedOrderId | 关联订单编号 | string | - |
| relatedOrderName | 关联订单名称 | string | - |

**原材料库存（RawMaterialInventory）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| inventoryId | 库存编号 | string | 唯一；必填 |
| rawMaterialId | 原材料编号 | string | - |
| rawMaterialName | 原材料名称 | string | - |
| materialType | 材料类型 | string | - |
| pendingReceiptQuantity | 待入库量 | number | - |
| cumulativeStockQuantity | 累计库存量 | number | - |
| availableStock | 可用库存 | number | - |
| unit | 单位 | string | - |

**客户订单（CustomerOrder）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| customerOrderId | 订单编号 | string | 唯一；必填 |
| customerOrderName | 订单名称 | string | - |
| batchNumber | 订单批次号 | string | - |
| bufferPeriod | 订单缓冲周期 | number | - |
| orderType | 订单类型 | enum | - |
| status | 订单状态 | enum | - |

**交货能力（DeliveryCapability）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| rawMaterialId | 原材料编号 | string | - |
| rawMaterialName | 原材料名称 | string | - |
| supplierName | 供应商名称 | string | - |
| supplierId | 供应商编号 | string | - |
| leadTime | 交货周期 | number | - |
| minCount | 最小交货数 | number | - |

## 4 重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

原材料采购到入库（ProcureAndReceiveRawMaterial）：完成从库存查询到采购、入库的完整流程。

- step: QueryInventory（用户或系统查询原材料库存，判断是否需要采购。）衔接=串行
- step: CreatePurchaseRecord（根据库存情况或客户订单需求，创建原材料采购单。）衔接=串行
- step: QueryPurchaseRecords（定期或主动按需查询采购记录，跟踪已创建的采购单状态。）衔接=串行
- step: ReceiveRawMaterial（确认原材料到货，执行入库操作，更新库存。）衔接=串行

## 5 行为

### 5.1 CreatePurchaseRecord
- **类型**: create（创建）
- **行为描述**: 创建一笔新的原材料采购记录。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "title": "原材料编号", "required": true, "example": "RM-001"},
  "rawMaterialName": {"type": "string", "title": "原材料名称", "required": true, "example": "高强度钢板"},
  "arrivalQuantity": {"type": "number", "title": "到位数量", "required": true, "example": 50},
  "supplierName": {"type": "string", "title": "供应商名称", "required": true, "example": "XX钢铁集团"},
  "arrivalTime": {"type": "string", "title": "到位时间", "required": true, "example": "2023-11-10"},
  "relatedOrderId": {"type": "string", "title": "关联订单编号", "required": false, "example": "SO-20231025-001"},
  "relatedOrderName": {"type": "string", "title": "关联订单名称", "required": false, "example": "客户A-项目X订单"},
  "unit": {"type": "string", "title": "单位", "required": true, "example": "吨"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "title": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "title": "原材料编号", "example": "RM-001"},
      "rawMaterialName": {"type": "string", "title": "原材料名称", "example": "高强度钢板"},
      "purchaseTime": {"type": "string", "title": "采购时间", "example": "2023-10-27"},
      "arrivalTime": {"type": "string", "title": "到位时间", "example": "2023-11-10"},
      "arrivalQuantity": {"type": "number", "title": "到位数量", "example": 50},
      "unit": {"type": "string", "title": "单位", "example": "吨"},
      "supplierName": {"type": "string", "title": "供应商名称", "example": "XX钢铁集团"},
      "relatedOrderId": {"type": "string", "title": "关联订单编号", "example": "SO-20231025-001"},
      "relatedOrderName": {"type": "string", "title": "关联订单名称", "example": "客户A-项目X订单"},
      "leadTime": {"type": "number", "title": "等待周期", "example": 14},
      "status": {"type": "string", "title": "状态", "example": "待入库"}
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）、供应商（Supplier）、客户订单（CustomerOrder）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `CreatePurchaseRecord`，参数即上述输入参数。

### 5.2 CancelPurchaseRecord
- **类型**: update（更新）
- **行为描述**: 取消一笔已创建但尚未入库的采购记录。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "title": "采购单号", "required": true, "example": "PO-20231027-001"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "title": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "title": "原材料ID", "example": "CRX001"},
      "rawMaterialName": {"type": "string", "title": "原材料名称", "example": "高强度钢板"}
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `CancelPurchaseRecord`，参数即上述输入参数。

### 5.3 ReceiveRawMaterial
- **类型**: update（更新）
- **行为描述**: 将原材料采购入库。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "title": "采购单号", "required": true, "example": "PO-20231027-001"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "title": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "title": "原材料ID", "example": "CRX001"},
      "rawMaterialName": {"type": "string", "title": "原材料名称", "example": "高强度钢板"}
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料库存（RawMaterialInventory）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `ReceiveRawMaterial`，参数即上述输入参数。

### 5.4 QueryInventory
- **类型**: query（查询）
- **行为描述**: 根据原材料ID或名称查询其最新的库存快照。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "title": "原材料编号", "required": false, "example": "RM-001"},
  "rawMaterialName": {"type": "string", "title": "原材料名称", "required": false, "example": "高强度钢板"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "inventoryId": {"type": "string", "title": "库存编号", "example": "INV-RM-001"},
        "rawMaterialId": {"type": "string", "title": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "title": "原材料名称", "example": "高强度钢板"},
        "materialType": {"type": "string", "title": "材料类型", "example": "原材料"},
        "pendingReceiptQuantity": {"type": "number", "title": "待入库量", "example": 50},
        "cumulativeStockQuantity": {"type": "number", "title": "累计库存量", "example": 200},
        "availableStock": {"type": "number", "title": "可用库存", "example": 150},
        "unit": {"type": "string", "title": "单位", "example": "吨"}
      }
    }
  }
}
```
- **相关概念**: 原材料库存（RawMaterialInventory）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `QueryInventory`，参数即上述输入参数。

### 5.5 QueryPurchaseRecords
- **类型**: query（查询）
- **行为描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "title": "采购单号", "required": false, "example": "PO-20231027-001"},
  "rawMaterialId": {"type": "string", "title": "原材料编号", "required": false, "example": "RM-001"},
  "rawMaterialName": {"type": "string", "title": "原材料名称", "required": false, "example": "高强度钢板"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "purchaseRecordId": {"type": "string", "title": "采购单号", "example": "PO-20231027-001"},
        "rawMaterialId": {"type": "string", "title": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "title": "原材料名称", "example": "高强度钢板"},
        "purchaseTime": {"type": "string", "title": "采购时间", "example": "2023-10-27"},
        "arrivalTime": {"type": "string", "title": "到位时间", "example": "2023-11-10"},
        "arrivalQuantity": {"type": "number", "title": "到位数量", "example": 50},
        "unit": {"type": "string", "title": "单位", "example": "吨"},
        "supplierName": {"type": "string", "title": "供应商名称", "example": "XX钢铁集团"},
        "relatedOrderId": {"type": "string", "title": "关联订单编号", "example": "SO-20231025-001"},
        "relatedOrderName": {"type": "string", "title": "关联订单名称", "example": "客户A-项目X订单"},
        "leadTime": {"type": "number", "title": "等待周期", "example": 14}
      }
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）、供应商（Supplier）、客户订单（CustomerOrder）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `QueryPurchaseRecords`，参数即上述输入参数。

### 5.6 QueryRawMaterials
- **类型**: query（查询）
- **行为描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "title": "原材料编号", "required": false, "example": "RM-001"},
  "rawMaterialName": {"type": "string", "title": "原材料名称", "required": false, "example": "高强度钢板"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "rawMaterialId": {"type": "string", "title": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "title": "原材料名称", "example": "高强度钢板"},
        "unit": {"type": "string", "title": "单位", "example": "吨"},
        "safetyStock": {"type": "number", "title": "安全库存", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `QueryRawMaterials`，参数即上述输入参数。

### 5.7 QuerySuppliers
- **类型**: query（查询）
- **行为描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "title": "供应商名称", "required": false, "example": "宝钢钢铁集团"},
  "rawMaterialName": {"type": "string", "title": "原材料名称", "required": false, "example": "钢板008"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "supplierId": {"type": "string", "title": "供应商编号", "example": "SUP-001"},
        "supplierName": {"type": "string", "title": "供应商名称", "example": "宝钢钢铁集团"},
        "address": {"type": "string", "title": "地址", "example": "上海市宝山区富锦路888号"},
        "contactPerson": {"type": "string", "title": "联系人", "example": "张经理"},
        "contactPhone": {"type": "string", "title": "联系电话", "example": "13800131001"}
      }
    }
  }
}
```
- **相关概念**: 供应商（Supplier）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `QuerySuppliers`，参数即上述输入参数。

### 5.8 QuerySupplierCapability
- **类型**: query（查询）
- **行为描述**: 根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "title": "供应商名称", "required": false, "example": "宝钢钢铁集团"},
  "rawMaterialName": {"type": "string", "title": "原材料名称", "required": false, "example": "钢板008"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "integer", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "supplierName": {"type": "string", "title": "供应商名称", "example": "宝钢钢铁集团"},
        "rawMaterialId": {"type": "string", "title": "原材料ID", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "title": "原材料名称", "example": "高强度钢板"},
        "leadTime": {"type": "number", "title": "交货周期", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 交货能力（DeliveryCapability）、供应商（Supplier）、原材料（RawMaterial）
- **执行方式**: 行为已 facade 化为 MCP 工具——**工具名即行为名**，直接调用工具 `QuerySupplierCapability`，参数即上述输入参数。