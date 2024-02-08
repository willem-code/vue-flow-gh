<script setup lang="ts">
import { Handle, Position, useHandleConnections, useNodesData } from '@vue-flow/core'

const sourceConnections = useHandleConnections({
  type: 'target',
})

const valueConnections = useHandleConnections({
  type: 'target',
  nodeId: () => sourceConnections.value[0].source,
})

const operatorData = useNodesData(() => sourceConnections.value.map((connection) => connection.source))

const valueData = useNodesData(() => valueConnections.value.map((connection) => connection.source))

const mathFunctions = {
  '+': (a: number, b: number) => a + b,
  '-': (a: number, b: number) => a - b,
  '*': (a: number, b: number) => a * b,
  '/': (a: number, b: number) => a / b,
}

const result = computed(() =>
  operatorData.value.reduce((acc, data) => {
    const operator = data.operator as keyof typeof mathFunctions

    if (operator) {
      const [a, b] = valueData.value.map((data) => data.value) as [number, number]
      return mathFunctions[operator](a, b)
    }

    return acc
  }, 0),
)
</script>

<template>
  <div class="result-node">
    <h2>Result</h2>
    <p>{{ result }}</p>

    <Handle type="target" :position="Position.Left" />
  </div>
</template>

<style scoped>
.result-node {
  padding: 8px;
  background-color: #f3f4f6;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
</style>
