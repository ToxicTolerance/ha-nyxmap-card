import { css } from "lit";

export const nyxmapFormListEditorStyles = css`
  :host {
    display: block;
  }
  .row {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 6px;
    margin-bottom: 8px;
    overflow: hidden;
  }
  .row-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: var(--secondary-background-color, #f5f5f5);
  }
  .summary {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--primary-text-color, #212121);
    font-size: 14px;
    padding: 4px 6px;
    border-radius: 4px;
  }
  button:hover {
    background: var(--divider-color, #e0e0e0);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  button:disabled:hover {
    background: transparent;
  }
  ha-form {
    display: block;
    padding: 8px 12px 12px;
  }
  .add {
    display: block;
    width: 100%;
    text-align: center;
    border: 1px dashed var(--divider-color, #e0e0e0);
    padding: 8px;
  }
`;
