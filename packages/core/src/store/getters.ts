import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import type { ComputedGetters, GraphEdge, GraphNode, State } from '../types'
import { ErrorCode, VueFlowError, getNodesInside, isEdgeVisible } from '../utils'
import { defaultEdgeTypes, defaultNodeTypes } from '../utils/defaultNodesEdges'

export function useGetters(
  state: State,
  nodesMap: ComputedRef<Map<string, GraphNode>>,
  edgesMap: ComputedRef<Map<string, GraphEdge>>,
): ComputedGetters {
  /**
   * @deprecated will be removed in next major version; use findNode instead
   */
  const getNode: ComputedGetters['getNode'] = computed(() => (id: string) => nodesMap.value.get(id))

  /**
   * @deprecated will be removed in next major version; use findEdge instead
   */
  const getEdge: ComputedGetters['getEdge'] = computed(() => (id: string) => edgesMap.value.get(id))

  const getEdgeTypes: ComputedGetters['getEdgeTypes'] = computed(() => {
    const edgeTypes: Record<string, any> = {
      ...defaultEdgeTypes,
      ...state.edgeTypes,
    }

    const keys = Object.keys(edgeTypes)

    for (const e of state.edges) {
      e.type && !keys.includes(e.type) && (edgeTypes[e.type] = e.type)
    }

    return edgeTypes
  })

  const getNodeTypes: ComputedGetters['getNodeTypes'] = computed(() => {
    const nodeTypes: Record<string, any> = {
      ...defaultNodeTypes,
      ...state.nodeTypes,
    }

    const keys = Object.keys(nodeTypes)

    for (const n of state.nodes) {
      n.type && !keys.includes(n.type) && (nodeTypes[n.type] = n.type)
    }

    return nodeTypes
  })

  const getNodes: ComputedGetters['getNodes'] = computed(() => {
    const nodes = state.nodes.filter((n) => !n.hidden)

    return state.onlyRenderVisibleElements
      ? nodes &&
          getNodesInside(
            nodes,
            {
              x: 0,
              y: 0,
              width: state.dimensions.width,
              height: state.dimensions.height,
            },
            state.viewport,
            true,
          )
      : nodes ?? []
  })

  const edgeHidden = (e: GraphEdge, source?: GraphNode, target?: GraphNode) => {
    source = source ?? getNode.value(e.source)
    target = target ?? getNode.value(e.target)

    if (!source || !target) {
      state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_ORPHANED, e.id))
      return
    }

    return !e.hidden && !target.hidden && !source.hidden
  }

  const getEdges: ComputedGetters['getEdges'] = computed(() => {
    if (!state.onlyRenderVisibleElements) {
      return state.edges.filter((edge) => edgeHidden(edge))
    }

    return state.edges.filter((e) => {
      const source = getNode.value(e.source)!
      const target = getNode.value(e.target)!

      return (
        edgeHidden(e, source, target) &&
        isEdgeVisible({
          sourcePos: source.computedPosition || { x: 0, y: 0 },
          targetPos: target.computedPosition || { x: 0, y: 0 },
          sourceWidth: source.dimensions.width,
          sourceHeight: source.dimensions.height,
          targetWidth: target.dimensions.width,
          targetHeight: target.dimensions.height,
          width: state.dimensions.width,
          height: state.dimensions.height,
          viewport: state.viewport,
        })
      )
    })
  })

  const getElements: ComputedGetters['getElements'] = computed(() => [...getNodes.value, ...getEdges.value])

  const getSelectedNodes: ComputedGetters['getSelectedNodes'] = computed(() => state.nodes.filter((n) => n.selected))

  const getSelectedEdges: ComputedGetters['getSelectedEdges'] = computed(() => state.edges.filter((e) => e.selected))

  const getSelectedElements: ComputedGetters['getSelectedElements'] = computed(() => [
    ...(getSelectedNodes.value ?? []),
    ...(getSelectedEdges.value ?? []),
  ])

  /**
   * @deprecated will be removed in next major version; use `useNodesInitialized` instead
   */
  const getNodesInitialized: ComputedGetters['getNodesInitialized'] = computed(() =>
    getNodes.value.filter((n) => n.initialized && n.handleBounds !== undefined),
  )

  /**
   * @deprecated will be removed in next major version; use `useNodesInitialized` instead
   */
  const areNodesInitialized: ComputedGetters['areNodesInitialized'] = computed(
    () => getNodes.value.length > 0 && getNodesInitialized.value.length === getNodes.value.length,
  )

  return {
    getNode,
    getEdge,
    getElements,
    getEdgeTypes,
    getNodeTypes,
    getEdges,
    getNodes,
    getSelectedElements,
    getSelectedNodes,
    getSelectedEdges,
    getNodesInitialized,
    areNodesInitialized,
  }
}
