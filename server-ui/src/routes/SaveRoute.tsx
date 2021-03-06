import React, { useState } from "react";
import { RouteComponentProps } from "react-router";
import {
  GetSchemaResponse,
  MetaOperation,
  Key,
  MetaTransaction,
  MetaEntity,
  Schema,
  SchemaKind,
  SchemaFieldEditorInfo,
  SchemaField,
  ValueType
} from "../api/meta_pb";
import { PendingTransactionContext, PendingTransaction } from "../App";
import { g, serializeKey, getLastKindOfKey, prettifyKey, c } from "../core";
import { Link } from "react-router-dom";
import { ConfigstoreMetaServicePromiseClient } from "../api/meta_grpc_web_pb";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSpinner, faCheck } from "@fortawesome/free-solid-svg-icons";
import { createGrpcPromiseClient } from "../svcHost";
import moment from "moment";
import { nibblinsToDollarString } from "../FinancialInput";
import BigInt from "big-integer";
import { KeyView } from "../KeyView";

export interface SaveRouteProps extends RouteComponentProps<{}> {
  schema: GetSchemaResponse;
}

function getTypeForOperation(operation: MetaOperation) {
  if (operation.hasCreaterequest()) {
    return "Create";
  }
  if (operation.hasDeleterequest()) {
    return "Delete";
  }
  if (operation.hasGetrequest()) {
    return "Get";
  }
  if (operation.hasListrequest()) {
    return "List";
  }
  if (operation.hasUpdaterequest()) {
    return "Update";
  }
  return "(Unknown)";
}

function getEntityLinkForOperation(
  idx: number,
  operation: MetaOperation,
  pendingTransaction: PendingTransaction,
  schema: Schema
) {
  let key: Key | null = null;
  if (operation.hasCreaterequest()) {
    const entity = g(g(operation.getCreaterequest()).getEntity());
    return (
      <Link
        key={`pendingop_${idx}`}
        style={{
          display: "block"
        }}
        to={`/kind/${g(
          operation.getCreaterequest()
        ).getKindname()}/create/pending/${idx}`}
      >
        Pending{" "}
        {entity.getKey() === undefined
          ? g(operation.getCreaterequest()).getKindname()
          : prettifyKey(g(entity.getKey()))}
      </Link>
    );
  }
  if (operation.hasDeleterequest()) {
    key = g(g(operation.getDeleterequest()).getKey());
  }
  if (operation.hasGetrequest()) {
    return null;
  }
  if (operation.hasListrequest()) {
    return null;
  }
  if (operation.hasUpdaterequest()) {
    key = g(g(g(operation.getUpdaterequest()).getEntity()).getKey());
  }
  if (key !== null) {
    return (
      <KeyView
        pendingTransaction={pendingTransaction}
        schema={schema}
        value={key}
      />
    );
  }
  return null;
}

function renderTextValue(field: SchemaField, entity: MetaEntity) {
  const fieldData = entity
    .getValuesList()
    .filter(fieldData => fieldData.getId() == field.getId())[0];
  const editor = c(field.getEditor(), new SchemaFieldEditorInfo());
  if (fieldData === undefined) {
    return <>-</>;
  }
  switch (fieldData.getType()) {
    case ValueType.STRING:
      return fieldData.getStringvalue();
    case ValueType.DOUBLE:
      return fieldData.getDoublevalue();
    case ValueType.INT64:
      if (editor.getUsefinancialvaluetonibblinsconversion()) {
        return nibblinsToDollarString(BigInt(fieldData.getInt64value()));
      } else {
        return fieldData.getInt64value();
      }
    case ValueType.UINT64:
      if (editor.getUsefinancialvaluetonibblinsconversion()) {
        return nibblinsToDollarString(BigInt(fieldData.getUint64value()));
      } else {
        return fieldData.getUint64value();
      }
    case ValueType.KEY:
      const childKey = fieldData.getKeyvalue();
      if (childKey === undefined) {
        return "-";
      } else {
        return (
          <Link
            to={`/kind/${getLastKindOfKey(childKey)}/edit/${serializeKey(
              g(childKey)
            )}`}
          >
            {prettifyKey(childKey)}
          </Link>
        );
      }
    case ValueType.BOOLEAN:
      return fieldData.getBooleanvalue() ? (
        <FontAwesomeIcon icon={faCheck} fixedWidth />
      ) : (
        "-"
      );
    case ValueType.TIMESTAMP:
      const timestamp = fieldData.getTimestampvalue();
      if (timestamp === undefined) {
        return "-";
      } else {
        return moment.unix(timestamp.getSeconds()).toLocaleString();
      }
    case ValueType.BYTES:
      return <em>(bytes)</em>;
    default:
      return <>(unknown type {fieldData.getType()})</>;
  }
}

function getDetailsOfOperation(
  idx: number,
  operation: MetaOperation,
  schema: Schema
) {
  let entity: MetaEntity | null = null;
  let schemaKind: SchemaKind | null = null;
  if (operation.hasCreaterequest()) {
    entity = g(g(operation.getCreaterequest()).getEntity());
    schemaKind = g(
      schema.getKindsMap().get(g(g(operation.getCreaterequest()).getKindname()))
    );
  }
  if (operation.hasUpdaterequest()) {
    entity = g(g(operation.getUpdaterequest()).getEntity());
    schemaKind = g(
      schema
        .getKindsMap()
        .get(
          getLastKindOfKey(
            g(g(g(operation.getUpdaterequest()).getEntity()).getKey())
          )
        )
    );
  }
  if (entity === null || schemaKind === null) {
    return null;
  }
  return (
    <ul>
      {schemaKind.getFieldsList().map(field => {
        const editor = (field.getEditor(), new SchemaFieldEditorInfo());
        const displayName = c(editor.getDisplayname(), field.getName());
        return (
          <li key={field.getId()}>
            <strong>{displayName}:</strong> {renderTextValue(field, g(entity))}
          </li>
        );
      })}
    </ul>
  );
}

export const SaveRoute = (props: SaveRouteProps) => (
  <PendingTransactionContext.Consumer>
    {value => <SaveRealRoute {...props} pendingTransaction={value} />}
  </PendingTransactionContext.Consumer>
);

const SaveRealRoute = (
  props: SaveRouteProps & { pendingTransaction: PendingTransaction }
) => {
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const discard = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();

    props.pendingTransaction.setOperations([]);
  };
  const save = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();

    let moved = false;
    setIsSaving(true);
    try {
      const client = createGrpcPromiseClient(
        ConfigstoreMetaServicePromiseClient
      );
      const req = new MetaTransaction();
      req.setOperationsList(props.pendingTransaction.operations);
      props.pendingTransaction.setResponse(
        await client.svc.applyTransaction(req, client.meta)
      );
      props.pendingTransaction.setResponseOriginalOperations(
        props.pendingTransaction.operations
      );
      props.pendingTransaction.setOperations([]);
      props.history.push(`/review`);
      moved = true;
    } finally {
      if (!moved) {
        setIsSaving(false);
      }
    }
  };

  return (
    <>
      <div className="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-0 border-bottom">
        <h1 className="h2">Save Changes?</h1>
        <div className="btn-toolbar mb-2 mb-md-0">
          <button
            type="button"
            className={"btn btn-sm mr-2 btn-secondary"}
            onClick={discard}
            disabled={
              isSaving || props.pendingTransaction.operations.length === 0
            }
          >
            Discard All Pending Changes
          </button>
          <button
            type="button"
            className={"btn btn-sm mr-2 btn-success"}
            onClick={save}
            disabled={
              isSaving || props.pendingTransaction.operations.length === 0
            }
          >
            {isSaving ? (
              <>
                <FontAwesomeIcon icon={faSpinner} spin />
                &nbsp;
              </>
            ) : (
              ""
            )}
            Save Changes
          </button>
        </div>
      </div>
      <div className="table-responsive table-fixed-header">
        <table className="table table-sm table-bt-none table-hover">
          <thead>
            <tr>
              <th>Idx</th>
              <th>Type</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {props.pendingTransaction.operations.length === 0 ? (
              <>
                <tr>
                  <td colSpan={3} className="text-muted">
                    You have no pending changes to be saved.
                  </td>
                </tr>
              </>
            ) : null}
            {props.pendingTransaction.operations.map((value, idx) => (
              <tr key={idx}>
                <td>{idx}</td>
                <td>{getTypeForOperation(value)}</td>
                <td>
                  {getEntityLinkForOperation(
                    idx,
                    value,
                    props.pendingTransaction,
                    g(props.schema.getSchema())
                  )}
                </td>
                <td>
                  {getDetailsOfOperation(
                    idx,
                    value,
                    g(props.schema.getSchema())
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};
