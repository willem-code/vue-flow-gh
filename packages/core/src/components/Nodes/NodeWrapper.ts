import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, provide, ref, toRef, watch } from 'vue'
import { until } from '@vueuse/core'
import {
  ARIA_NODE_DESC_KEY,
  arrowKeyDiffs,
  calcNextPosition,
  elementSelectionKeys,
  getXYZPos,
  handleNodeClick,
} from '../../utils'
import type { HandleConnectable, NodeComponent } from '../../types'
import { NodeId, NodeRef } from '../../context'
import { isInputDOMNode, useDrag, useNodeHooks, useUpdateNodePositions, useVueFlow } from '../../composables'

interface Props {
  id: string
  draggable: boolean
  selectable: boolean
  connectable: HandleConnectable
  focusable: boolean
  type: NodeComponent | ((...args: any[]) => any) | object | false
  name: string
  resizeObserver: ResizeObserver
}

const NodeWrapper = defineComponent({
  name: 'Node',
  compatConfig: { MODE: 3 },
  props: ['name', 'type', 'id', 'draggable', 'selectable', 'focusable', 'connectable', 'resizeObserver'],
  setup(props: Props) {
    provide(NodeId, props.id)

    const {
      id: vueFlowId,
      noPanClassName,
      selectNodesOnDrag,
      nodesSelectionActive,
      multiSelectionActive,
      emits,
      findNode,
      removeSelectedNodes,
      addSelectedNodes,
      updateNodeDimensions,
      onUpdateNodeInternals,
      getIntersectingNodes,
      getNodeTypes,
      nodeExtent,
      elevateNodesOnSelect,
      disableKeyboardA11y,
      ariaLiveMessage,
      snapToGrid,
      snapGrid,
      nodeDragThreshold,
      getConnectedEdges,
    } = useVueFlow()

    const node = findNode(props.id)!

    const updateNodePositions = useUpdateNodePositions()

    const parentNode = computed(() => findNode(node.parentNode))

    const connectedEdges = computed(() => getConnectedEdges(props.id))

    const nodeElement = ref<HTMLDivElement | null>(null)

    provide(NodeRef, nodeElement)

    const { emit, on } = useNodeHooks(node, emits)

    const dragging = useDrag({
      id: props.id,
      el: nodeElement,
      disabled: () => !props.draggable,
      selectable: () => props.selectable,
      dragHandle: () => node.dragHandle,
      onStart(args) {
        emit.dragStart({ ...args, intersections: getIntersectingNodes(node) })
      },
      onDrag(args) {
        emit.drag({ ...args, intersections: getIntersectingNodes(node) })
      },
      onStop(args) {
        emit.dragStop({ ...args, intersections: getIntersectingNodes(node) })
      },
    })

    const getClass = computed(() => (node.class instanceof Function ? node.class(node) : node.class))

    const getStyle = computed(() => {
      const styles = (node.style instanceof Function ? node.style(node) : node.style) || {}

      const width = node.width instanceof Function ? node.width(node) : node.width
      const height = node.height instanceof Function ? node.height(node) : node.height

      if (width) {
        styles.width = typeof width === 'string' ? width : `${width}px`
      }

      if (height) {
        styles.height = typeof height === 'string' ? height : `${height}px`
      }

      return styles
    })

    const zIndex = toRef(() => Number(node.zIndex ?? getStyle.value.zIndex ?? 0))

    onUpdateNodeInternals((updateIds) => {
      if (updateIds.includes(props.id)) {
        updateInternals()
      }
    })

    onMounted(() => {
      props.resizeObserver.observe(nodeElement.value as HTMLDivElement)
    })

    onBeforeUnmount(() => {
      props.resizeObserver.unobserve(nodeElement.value as HTMLDivElement)
    })

    watch([() => node.type, () => node.sourcePosition, () => node.targetPosition], () => {
      nextTick(() => {
        updateNodeDimensions([{ id: props.id, nodeElement: nodeElement.value as HTMLDivElement, forceUpdate: true }])
      })
    })

    /** this watcher only updates XYZPosition (when dragging a parent etc) */
    watch(
      [
        () => node.position.x,
        () => node.position.y,
        () => parentNode.value?.computedPosition.x,
        () => parentNode.value?.computedPosition.y,
        () => parentNode.value?.computedPosition.z,
        zIndex,
        () => node.selected,
        () => node.dimensions.height,
        () => node.dimensions.width,
        () => parentNode.value?.dimensions.height,
        () => parentNode.value?.dimensions.width,
      ],
      ([newX, newY, parentX, parentY, parentZ, nodeZIndex]) => {
        const xyzPos = {
          x: newX,
          y: newY,
          z: nodeZIndex + (elevateNodesOnSelect.value ? (node.selected ? 1000 : 0) : 0),
        }

        if (typeof parentX !== 'undefined' && typeof parentY !== 'undefined') {
          node.computedPosition = getXYZPos({ x: parentX, y: parentY, z: parentZ! }, xyzPos)
        } else {
          node.computedPosition = xyzPos
        }
      },
      { flush: 'post', immediate: true },
    )

    watch([() => node.extent, nodeExtent], ([nodeExtent, globalExtent], [oldNodeExtent, oldGlobalExtent]) => {
      // update position if extent has actually changed
      if (nodeExtent !== oldNodeExtent || globalExtent !== oldGlobalExtent) {
        clampPosition()
      }
    })

    // clamp initial position to nodes' extent
    // if extent is parent, we need dimensions to properly clamp the position
    if (
      node.extent === 'parent' ||
      (typeof node.extent === 'object' && 'range' in node.extent && node.extent.range === 'parent')
    ) {
      until(() => node.initialized)
        .toBe(true)
        .then(clampPosition)
    }
    // if extent is not parent, we can clamp it immediately
    else {
      clampPosition()
    }

    return () =>
      h(
        'div',
        {
          'ref': nodeElement,
          'data-id': node.id,
          'class': [
            'vue-flow__node',
            `vue-flow__node-default`,
            {
              [noPanClassName.value]: props.draggable,
              dragging: dragging?.value,
              draggable: props.draggable,
              selected: node.selected,
              selectable: props.selectable,
              parent: node.isParent,
            },
            getClass.value,
          ],
          'style': {
            visibility: node.initialized ? 'visible' : 'hidden',
            zIndex: node.computedPosition.z ?? zIndex.value,
            transform: `translate(${node.computedPosition.x}px,${node.computedPosition.y}px)`,
            pointerEvents: props.selectable || props.draggable ? 'all' : 'none',
            ...getStyle.value,
          },
          'tabIndex': props.focusable ? 0 : undefined,
          'role': props.focusable ? 'button' : undefined,
          'aria-describedby': disableKeyboardA11y.value ? undefined : `${ARIA_NODE_DESC_KEY}-${vueFlowId}`,
          'aria-label': node.ariaLabel,
          'onMouseenter': onMouseEnter,
          'onMousemove': onMouseMove,
          'onMouseleave': onMouseLeave,
          'onContextmenu': onContextMenu,
          'onClick': onSelectNode,
          'onDblclick': onDoubleClick,
          'onKeydown': onKeyDown,
        },
        [
          h(getNodeTypes.value.default, {
            id: node.id,
            type: node.type,
            data: node.data,
            events: { ...node.events, ...on },
            selected: node.selected,
            resizing: node.resizing,
            dragging: dragging.value,
            connectable: props.connectable,
            position: node.computedPosition,
            dimensions: node.dimensions,
            isValidTargetPos: node.isValidTargetPos,
            isValidSourcePos: node.isValidSourcePos,
            parent: node.parentNode,
            parentNodeId: node.parentNode,
            zIndex: node.computedPosition.z ?? zIndex.value,
            targetPosition: node.targetPosition,
            sourcePosition: node.sourcePosition,
            label: node.label,
            dragHandle: node.dragHandle,
            onUpdateNodeInternals: updateInternals,
          }),
        ],
      )

    /** this re-calculates the current position, necessary for clamping by a node's extent */
    function clampPosition() {
      const nextPos = node.computedPosition

      if (snapToGrid.value) {
        nextPos.x = snapGrid.value[0] * Math.round(nextPos.x / snapGrid.value[0])
        nextPos.y = snapGrid.value[1] * Math.round(nextPos.y / snapGrid.value[1])
      }

      const { computedPosition, position } = calcNextPosition(node, nextPos, emits.error, nodeExtent.value, parentNode.value)

      // only overwrite positions if there are changes when clamping
      if (node.computedPosition.x !== computedPosition.x || node.computedPosition.y !== computedPosition.y) {
        node.computedPosition = { ...node.computedPosition, ...computedPosition }
      }

      if (node.position.x !== position.x || node.position.y !== position.y) {
        node.position = position
      }
    }

    function updateInternals() {
      if (nodeElement.value) {
        updateNodeDimensions([{ id: props.id, nodeElement: nodeElement.value, forceUpdate: true }])
      }
    }

    function onMouseEnter(event: MouseEvent) {
      if (!dragging?.value) {
        emit.mouseEnter({ event, node, connectedEdges: connectedEdges.value })
      }
    }

    function onMouseMove(event: MouseEvent) {
      if (!dragging?.value) {
        emit.mouseMove({ event, node, connectedEdges: connectedEdges.value })
      }
    }

    function onMouseLeave(event: MouseEvent) {
      if (!dragging?.value) {
        emit.mouseLeave({ event, node, connectedEdges: connectedEdges.value })
      }
    }

    function onContextMenu(event: MouseEvent) {
      return emit.contextMenu({ event, node, connectedEdges: connectedEdges.value })
    }

    function onDoubleClick(event: MouseEvent) {
      return emit.doubleClick({ event, node, connectedEdges: connectedEdges.value })
    }

    function onSelectNode(event: MouseEvent) {
      if (props.selectable && (!selectNodesOnDrag.value || !props.draggable || nodeDragThreshold.value > 0)) {
        handleNodeClick(
          node,
          multiSelectionActive.value,
          addSelectedNodes,
          removeSelectedNodes,
          nodesSelectionActive,
          false,
          nodeElement.value!,
        )
      }

      emit.click({ event, node, connectedEdges: connectedEdges.value })
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isInputDOMNode(event) || disableKeyboardA11y.value) {
        return
      }

      if (elementSelectionKeys.includes(event.key) && props.selectable) {
        const unselect = event.key === 'Escape'

        handleNodeClick(
          node,
          multiSelectionActive.value,
          addSelectedNodes,
          removeSelectedNodes,
          nodesSelectionActive,
          unselect,
          nodeElement.value!,
        )
      } else if (props.draggable && node.selected && arrowKeyDiffs[event.key]) {
        ariaLiveMessage.value = `Moved selected node ${event.key.replace('Arrow', '').toLowerCase()}. New position, x: ${~~node
          .position.x}, y: ${~~node.position.y}`

        updateNodePositions(
          {
            x: arrowKeyDiffs[event.key].x,
            y: arrowKeyDiffs[event.key].y,
          },
          event.shiftKey,
        )
      }
    }
  },
})

export default NodeWrapper
