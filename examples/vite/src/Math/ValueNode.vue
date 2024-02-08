<script setup lang="ts">
import type { NodeProps } from '@vue-flow/core'
import { Handle, Position, useVueFlow } from '@vue-flow/core'

interface ValueData {
  value: number
}

const props = defineProps<Pick<NodeProps<ValueData>, 'id' | 'data'>>()

const { updateNodeData } = useVueFlow()

function onChange(event: Event) {
  const evt = event as InputEvent

  const target = evt.target as HTMLInputElement

  const value = Number.parseFloat(target.value)

  if (!Number.isNaN(value)) {
    updateNodeData(props.id, { value })
  }
}
</script>

<template>
  <div class="input-node">
    <label :for="`${id}.input`">Value</label>
    <input :id="`${id}-input`" :value="data.value" type="number" @change="onChange" />

    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.input-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background-color: #f3f4f6;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
</style>
