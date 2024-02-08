<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { Handle, Position, useHandleConnections, useNodesData, useVueFlow } from '@vue-flow/core'

interface OperatorData {
  operator: '+' | '-' | '*' | '/'
  values: string[]
}

const props = defineProps<Pick<NodeProps<OperatorData>, 'id' | 'data'>>()

const operators = ['+', '-', '*', '/']

const { updateNodeData } = useVueFlow()

const sourceConnections = useHandleConnections({
  type: 'target',
})

const sourceNodeData = useNodesData(() => sourceConnections.value.map((connection) => connection.source))

function onChange(event: Event) {
  const evt = event as InputEvent

  const target = evt.target as HTMLSelectElement

  const operator = target.value as OperatorData['operator']

  updateNodeData(props.id, { operator })
}
</script>

<template>
  <div class="operator-node">
    <label :for="`${id}.operator`">Operator</label>
    <select :id="`${id}-operator`" :value="data.operator" @change="onChange">
      <option v-for="operator in operators" :key="operator" :value="operator">{{ operator }}</option>
    </select>

    <Handle type="source" :position="Position.Right" />
    <Handle type="target" :position="Position.Left" />
  </div>
</template>

<style scoped>
.operator-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background-color: #f3f4f6;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
</style>
