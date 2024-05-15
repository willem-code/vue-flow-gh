import { zoomIdentity } from 'd3-zoom'
import type { ComputedRef } from 'vue'
import { nextTick } from 'vue'
import { until } from '@vueuse/core'
import type {
  Actions,
  CoordinateExtent,
  EdgeChange,
  EdgeRemoveChange,
  EdgeSelectionChange,
  Elements,
  FlowExportObject,
  GraphEdge,
  GraphNode,
  Node,
  NodeChange,
  NodeDimensionChange,
  NodePositionChange,
  NodeRemoveChange,
  NodeSelectionChange,
  Rect,
  State,
} from '../types'
import { useViewportHelper } from '../composables'
import {
  ErrorCode,
  VueFlowError,
  addEdgeToStore,
  applyChanges,
  clamp,
  createAdditionChange,
  createEdgeRemoveChange,
  createGraphNodes,
  createNodeRemoveChange,
  createSelectionChange,
  getConnectedEdges as getConnectedEdgesBase,
  getDimensions,
  getHandleBounds,
  getIncomers as getIncomersBase,
  getOutgoers as getOutgoersBase,
  getOverlappingArea,
  getSelectionChanges,
  isDef,
  isEdge,
  isGraphNode,
  isNode,
  isRect,
  nodeToRect,
  parseEdge,
  updateConnectionLookup,
  updateEdgeAction,
} from '../utils'
import { storeOptionsToSkip, useState } from './state'

export function useActions(
  id: string,
  state: State,
  nodesMap: ComputedRef<Map<string, GraphNode>>,
  edgesMap: ComputedRef<Map<string, GraphEdge>>,
): Actions {
  const viewportHelper = useViewportHelper(state)

  const updateNodeInternals: Actions['updateNodeInternals'] = (ids) => {
    const updateIds = ids ?? state.nodes.map((n) => n.id)

    state.hooks.updateNodeInternals.trigger(updateIds)
  }

  const getIncomers: Actions['getIncomers'] = (nodeOrId) => {
    return getIncomersBase(nodeOrId, state.nodes, state.edges)
  }

  const getOutgoers: Actions['getOutgoers'] = (nodeOrId) => {
    return getOutgoersBase(nodeOrId, state.nodes, state.edges)
  }

  const getConnectedEdges: Actions['getConnectedEdges'] = (nodesOrId) => {
    return getConnectedEdgesBase(nodesOrId, state.edges)
  }

  const findNode: Actions['findNode'] = (id) => {
    if (!id) {
      return undefined
    }

    return nodesMap.value.get(id)
  }

  const findEdge: Actions['findEdge'] = (id) => {
    if (!id) {
      return undefined
    }

    return edgesMap.value.get(id)
  }

  const updateNodePositions: Actions['updateNodePositions'] = (dragItems, changed, dragging) => {
    const changes: NodePositionChange[] = []

    for (const node of dragItems) {
      const change: Partial<NodePositionChange> = {
        id: node.id,
        type: 'position',
        dragging,
        from: node.from,
      }

      if (changed) {
        change.position = node.position

        if (node.parentNode) {
          const parentNode = findNode(node.parentNode)

          change.position = {
            x: change.position.x - (parentNode?.computedPosition?.x ?? 0),
            y: change.position.y - (parentNode?.computedPosition?.y ?? 0),
          }
        }
      }

      changes.push(change as NodePositionChange)
    }

    if (changes?.length) {
      state.hooks.nodesChange.trigger(changes)
    }
  }

  const updateNodeDimensions: Actions['updateNodeDimensions'] = (updates) => {
    if (!state.vueFlowRef) {
      return
    }

    const viewportNode = state.vueFlowRef.querySelector('.vue-flow__transformationpane') as HTMLElement

    if (!viewportNode) {
      return
    }

    const style = window.getComputedStyle(viewportNode)
    const { m22: zoom } = new window.DOMMatrixReadOnly(style.transform)

    const changes: NodeDimensionChange[] = updates.reduce<NodeDimensionChange[]>((res, update) => {
      const node = findNode(update.id)

      if (node) {
        const dimensions = getDimensions(update.nodeElement)

        const doUpdate = !!(
          dimensions.width &&
          dimensions.height &&
          (node.dimensions.width !== dimensions.width || node.dimensions.height !== dimensions.height || update.forceUpdate)
        )

        if (doUpdate) {
          node.handleBounds.source = getHandleBounds('.source', update.nodeElement, zoom)
          node.handleBounds.target = getHandleBounds('.target', update.nodeElement, zoom)
          node.dimensions = dimensions
          node.initialized = true

          res.push({
            id: node.id,
            type: 'dimensions',
            dimensions,
          })
        }
      }

      return res
    }, [])

    if (!state.fitViewOnInitDone && state.fitViewOnInit) {
      nextTick(() => {
        viewportHelper.value.fitView()
        state.fitViewOnInitDone = true
      })
    }

    if (changes.length) {
      state.hooks.nodesChange.trigger(changes)
    }
  }

  const nodeSelectionHandler = (nodes: GraphNode[], selected: boolean) => {
    const nodeIds = nodes.map((n) => n.id)

    let changedNodes: NodeChange[]
    let changedEdges: EdgeChange[] = []

    if (state.multiSelectionActive) {
      changedNodes = nodeIds.map((nodeId) => createSelectionChange(nodeId, selected))
    } else {
      const selectionChanges = getSelectionChanges([...state.nodes, ...state.edges], nodeIds)
      changedNodes = selectionChanges.changedNodes
      changedEdges = selectionChanges.changedEdges
    }

    if (changedNodes.length) {
      state.hooks.nodesChange.trigger(changedNodes)
    }

    if (changedEdges.length) {
      state.hooks.edgesChange.trigger(changedEdges)
    }
  }

  const edgeSelectionHandler = (edges: GraphEdge[], selected: boolean) => {
    const edgeIds = edges.map((e) => e.id)

    let changedNodes: NodeChange[] = []
    let changedEdges: EdgeChange[]

    if (state.multiSelectionActive) {
      changedEdges = edgeIds.map((edgeId) => createSelectionChange(edgeId, selected))
    } else {
      const selectionChanges = getSelectionChanges([...state.nodes, ...state.edges], edgeIds)
      changedNodes = selectionChanges.changedNodes
      changedEdges = selectionChanges.changedEdges
    }

    if (changedNodes.length) {
      state.hooks.nodesChange.trigger(changedNodes)
    }

    if (changedEdges.length) {
      state.hooks.edgesChange.trigger(changedEdges)
    }
  }

  const elementSelectionHandler = (elements: Elements, selected: boolean) => {
    const nodeIds = elements.filter(isNode).map((n) => n.id)
    const edgeIds = elements.filter(isEdge).map((e) => e.id)

    let { changedNodes, changedEdges } = getSelectionChanges([...state.nodes, ...state.edges], [...nodeIds, ...edgeIds])

    if (state.multiSelectionActive) {
      changedNodes = nodeIds.map((nodeId) => createSelectionChange(nodeId, selected))
      changedEdges = edgeIds.map((edgeId) => createSelectionChange(edgeId, selected))
    }

    if (changedNodes.length) {
      state.hooks.nodesChange.trigger(changedNodes)
    }

    if (changedEdges.length) {
      state.hooks.edgesChange.trigger(changedEdges)
    }
  }

  const addSelectedNodes: Actions['addSelectedNodes'] = (nodes) => {
    nodeSelectionHandler(nodes, true)
  }

  const addSelectedEdges: Actions['addSelectedEdges'] = (edges) => {
    edgeSelectionHandler(edges, true)
  }

  const addSelectedElements: Actions['addSelectedElements'] = (elements) => {
    elementSelectionHandler(elements, true)
  }

  const removeSelectedNodes: Actions['removeSelectedNodes'] = (nodes) => {
    if (!nodes.length) {
      return nodeSelectionHandler(nodes, false)
    }

    const nodeIds = nodes.map((n) => n.id)

    const changedNodes = nodeIds.map((nodeId) => createSelectionChange(nodeId, false))

    if (changedNodes.length) {
      state.hooks.nodesChange.trigger(changedNodes)
    }
  }

  const removeSelectedEdges: Actions['removeSelectedEdges'] = (edges) => {
    if (!edges.length) {
      return edgeSelectionHandler(edges, false)
    }

    const edgeIds = edges.map((e) => e.id)

    const changedEdges = edgeIds.map((edgeId) => createSelectionChange(edgeId, false))

    if (changedEdges.length) {
      state.hooks.edgesChange.trigger(changedEdges)
    }
  }

  const removeSelectedElements: Actions['removeSelectedElements'] = (elements) => {
    if (!elements || !elements.length) {
      return elementSelectionHandler([], false)
    }

    const changes = elements.reduce(
      (changes, curr) => {
        const selectionChange = createSelectionChange(curr.id, false)

        if (isNode(curr)) {
          changes.nodes.push(selectionChange)
        } else {
          changes.edges.push(selectionChange)
        }

        return changes
      },
      { nodes: [] as NodeSelectionChange[], edges: [] as EdgeSelectionChange[] },
    )

    if (changes.nodes.length) {
      state.hooks.nodesChange.trigger(changes.nodes)
    }

    if (changes.edges.length) {
      state.hooks.edgesChange.trigger(changes.edges)
    }
  }

  const setMinZoom: Actions['setMinZoom'] = (minZoom) => {
    state.d3Zoom?.scaleExtent([minZoom, state.maxZoom])
    state.minZoom = minZoom
  }

  const setMaxZoom: Actions['setMaxZoom'] = (maxZoom) => {
    state.d3Zoom?.scaleExtent([state.minZoom, maxZoom])
    state.maxZoom = maxZoom
  }

  const setTranslateExtent: Actions['setTranslateExtent'] = (translateExtent) => {
    state.d3Zoom?.translateExtent(translateExtent)
    state.translateExtent = translateExtent
  }

  const setNodeExtent: Actions['setNodeExtent'] = (nodeExtent) => {
    state.nodeExtent = nodeExtent
    updateNodeInternals()
  }

  const setInteractive: Actions['setInteractive'] = (isInteractive) => {
    state.nodesDraggable = isInteractive
    state.nodesConnectable = isInteractive
    state.elementsSelectable = isInteractive
  }

  const setNodes: Actions['setNodes'] = (nodes) => {
    const nextNodes = nodes instanceof Function ? nodes(state.nodes) : nodes

    if (!state.initialized && !nextNodes.length) {
      return
    }

    state.nodes = createGraphNodes(nextNodes, state.nodes, findNode, state.hooks.error.trigger)
  }

  const setEdges: Actions['setEdges'] = (edges) => {
    const nextEdges = edges instanceof Function ? edges(state.edges) : edges

    if (!state.initialized && !nextEdges.length) {
      return
    }

    const validEdges = state.isValidConnection
      ? nextEdges.filter((edge) =>
          state.isValidConnection!(edge, {
            edges: state.edges,
            nodes: state.nodes,
            sourceNode: findNode(edge.source)!,
            targetNode: findNode(edge.target)!,
          }),
        )
      : nextEdges

    updateConnectionLookup(state.connectionLookup, validEdges)

    state.edges = validEdges.reduce<GraphEdge[]>((res, edge) => {
      const sourceNode = findNode(edge.source)
      const targetNode = findNode(edge.target)

      const missingSource = !sourceNode || typeof sourceNode === 'undefined'
      const missingTarget = !targetNode || typeof targetNode === 'undefined'

      if (missingSource && missingTarget) {
        state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_SOURCE_TARGET_MISSING, edge.id, edge.source, edge.target))
      } else {
        if (missingSource) {
          state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_SOURCE_MISSING, edge.id, edge.source))
        }

        if (missingTarget) {
          state.hooks.error.trigger(new VueFlowError(ErrorCode.EDGE_TARGET_MISSING, edge.id, edge.target))
        }
      }

      if (missingSource || missingTarget) {
        return res
      }

      const existingEdge = findEdge(edge.id)

      res.push({
        ...parseEdge(edge, existingEdge, state.defaultEdgeOptions),
        sourceNode,
        targetNode,
      })

      return res
    }, [])
  }

  const setElements: Actions['setElements'] = (elements) => {
    const nextElements = elements instanceof Function ? elements([...state.nodes, ...state.edges]) : elements

    if (!state.initialized && !nextElements.length) {
      return
    }

    setNodes(nextElements.filter(isNode))
    setEdges(nextElements.filter(isEdge))
  }

  const addNodes: Actions['addNodes'] = (nodes) => {
    let nextNodes = nodes instanceof Function ? nodes(state.nodes) : nodes
    nextNodes = Array.isArray(nextNodes) ? nextNodes : [nextNodes]

    const graphNodes = createGraphNodes(nextNodes, state.nodes, findNode, state.hooks.error.trigger)

    const changes = graphNodes.map(createAdditionChange)

    if (changes.length) {
      state.hooks.nodesChange.trigger(changes)
    }
  }

  const addEdges: Actions['addEdges'] = (params) => {
    let nextEdges = params instanceof Function ? params(state.edges) : params
    nextEdges = Array.isArray(nextEdges) ? nextEdges : [nextEdges]

    const validEdges = state.isValidConnection
      ? nextEdges.filter((edge) => {
          return state.isValidConnection?.(edge, {
            edges: state.edges,
            nodes: state.nodes,
            sourceNode: findNode(edge.source)!,
            targetNode: findNode(edge.target)!,
          })
        })
      : nextEdges

    const changes = validEdges.reduce((edgeChanges, connection) => {
      const edge = addEdgeToStore(connection, state.edges, state.hooks.error.trigger, state.defaultEdgeOptions)

      if (edge) {
        const sourceNode = findNode(edge.source)!
        const targetNode = findNode(edge.target)!

        edgeChanges.push(
          createAdditionChange<GraphEdge>({
            ...edge,
            sourceNode,
            targetNode,
          }),
        )
      }

      return edgeChanges
    }, [] as EdgeChange[])

    if (changes.length) {
      state.hooks.edgesChange.trigger(changes)
    }
  }

  const removeNodes: Actions['removeNodes'] = (nodes, removeConnectedEdges = true, removeChildren = false) => {
    const nextNodes = nodes instanceof Function ? nodes(state.nodes) : nodes
    const nodesToRemove = Array.isArray(nextNodes) ? nextNodes : [nextNodes]

    const nodeChanges: NodeRemoveChange[] = []
    const edgeChanges: EdgeRemoveChange[] = []

    function createEdgeRemovalChanges(nodes: Node[]) {
      const connections = getConnectedEdges(nodes).filter((edge) => (isDef(edge.deletable) ? edge.deletable : true))

      edgeChanges.push(
        ...connections.map((connection) =>
          createEdgeRemoveChange(
            connection.id,
            connection.source,
            connection.target,
            connection.sourceHandle,
            connection.targetHandle,
          ),
        ),
      )
    }

    // recursively get all children and if the child is a parent, get those children as well until all nodes have been removed that are children of the current node
    function createChildrenRemovalChanges(id: string) {
      const children = state.nodes.filter((n) => n.parentNode === id)

      if (children.length) {
        const childIds = children.map((n) => n.id)
        nodeChanges.push(...childIds.map((id) => createNodeRemoveChange(id)))

        if (removeConnectedEdges) {
          createEdgeRemovalChanges(children)
        }

        for (const child of children) {
          createChildrenRemovalChanges(child.id)
        }
      }
    }

    for (const item of nodesToRemove) {
      const currNode = typeof item === 'string' ? findNode(item) : item

      if (!currNode) {
        continue
      }

      if (isDef(currNode.deletable) && !currNode.deletable) {
        continue
      }

      nodeChanges.push(createNodeRemoveChange(currNode.id))

      if (removeConnectedEdges) {
        createEdgeRemovalChanges([currNode])
      }

      if (removeChildren) {
        createChildrenRemovalChanges(currNode.id)
      }
    }

    if (edgeChanges.length) {
      state.hooks.edgesChange.trigger(edgeChanges)
    }

    if (nodeChanges.length) {
      state.hooks.nodesChange.trigger(nodeChanges)
    }
  }

  const removeEdges: Actions['removeEdges'] = (edges) => {
    const nextEdges = edges instanceof Function ? edges(state.edges) : edges
    const edgesToRemove = Array.isArray(nextEdges) ? nextEdges : [nextEdges]

    const changes: EdgeRemoveChange[] = []

    for (const item of edgesToRemove) {
      const currEdge = typeof item === 'string' ? findEdge(item) : item

      if (!currEdge) {
        continue
      }

      if (isDef(currEdge.deletable) && !currEdge.deletable) {
        continue
      }

      changes.push(
        createEdgeRemoveChange(
          typeof item === 'string' ? item : item.id,
          currEdge.source,
          currEdge.target,
          currEdge.sourceHandle,
          currEdge.targetHandle,
        ),
      )
    }

    state.hooks.edgesChange.trigger(changes)
  }

  const updateEdge: Actions['updateEdge'] = (oldEdge, newConnection, shouldReplaceId = true) =>
    updateEdgeAction(oldEdge, newConnection, state.edges, findEdge, shouldReplaceId, state.hooks.error.trigger)

  const applyNodeChanges: Actions['applyNodeChanges'] = (changes) => {
    return applyChanges(changes, state.nodes)
  }

  const applyEdgeChanges: Actions['applyEdgeChanges'] = (changes) => {
    const changedEdges = applyChanges(changes, state.edges)

    updateConnectionLookup(state.connectionLookup, changedEdges)

    return changedEdges
  }

  // todo: maybe we should use a more immutable approach, this is a bit too much mutation and hard to maintain
  const updateNode: Actions['updateNode'] = (id, nodeUpdate, options = { replace: false }) => {
    const node = findNode(id)

    if (!node) {
      return
    }

    const nextNode = typeof nodeUpdate === 'function' ? nodeUpdate(node) : nodeUpdate

    if (options.replace) {
      state.nodes.splice(state.nodes.indexOf(node), 1, nextNode as GraphNode)
    } else {
      Object.assign(node, nextNode)
    }
  }

  const updateNodeData: Actions['updateNodeData'] = (id, dataUpdate, options = { replace: false }) => {
    updateNode(
      id,
      (node) => {
        const nextData = typeof dataUpdate === 'function' ? dataUpdate(node) : dataUpdate
        return options.replace ? { ...node, data: nextData } : { ...node, data: { ...node.data, ...nextData } }
      },
      options,
    )
  }

  const startConnection: Actions['startConnection'] = (startHandle, position, event, isClick = false) => {
    if (isClick) {
      state.connectionClickStartHandle = startHandle
    } else {
      state.connectionStartHandle = startHandle
    }

    state.connectionEndHandle = null
    state.connectionStatus = null

    if (position) {
      state.connectionPosition = position
    }
  }

  const updateConnection: Actions['updateConnection'] = (position, result = null, status = null) => {
    if (state.connectionStartHandle) {
      state.connectionPosition = position
      state.connectionEndHandle = result
      state.connectionStatus = status
    }
  }

  const endConnection: Actions['endConnection'] = (event, isClick) => {
    state.connectionPosition = { x: Number.NaN, y: Number.NaN }
    state.connectionEndHandle = null
    state.connectionStatus = null

    if (isClick) {
      state.connectionClickStartHandle = null
    } else {
      state.connectionStartHandle = null
    }
  }

  const getNodeRect = (
    nodeOrRect: (Partial<Node> & { id: Node['id'] }) | Rect,
  ): [Rect | null, Node | null | undefined, boolean] => {
    const isRectObj = isRect(nodeOrRect)
    const node = isRectObj ? null : isGraphNode(nodeOrRect as GraphNode) ? (nodeOrRect as GraphNode) : findNode(nodeOrRect.id)

    if (!isRectObj && !node) {
      return [null, null, isRectObj]
    }

    const nodeRect = isRectObj ? nodeOrRect : nodeToRect(node!)

    return [nodeRect, node, isRectObj]
  }

  // todo: rename to `findIntersectingNodes`
  const getIntersectingNodes: Actions['getIntersectingNodes'] = (nodeOrRect, partially = true, nodes = state.nodes) => {
    const [nodeRect, node, isRect] = getNodeRect(nodeOrRect)

    if (!nodeRect) {
      return []
    }

    return (nodes || state.nodes).filter((n) => {
      if (!isRect && (n.id === node!.id || !n.computedPosition)) {
        return false
      }

      const currNodeRect = nodeToRect(n)
      const overlappingArea = getOverlappingArea(currNodeRect, nodeRect)
      const partiallyVisible = partially && overlappingArea > 0

      return partiallyVisible || overlappingArea >= Number(nodeRect.width) * Number(nodeRect.height)
    })
  }

  const isNodeIntersecting: Actions['isNodeIntersecting'] = (nodeOrRect, area, partially = true) => {
    const [nodeRect] = getNodeRect(nodeOrRect)

    if (!nodeRect) {
      return false
    }

    const overlappingArea = getOverlappingArea(nodeRect, area)
    const partiallyVisible = partially && overlappingArea > 0

    return partiallyVisible || overlappingArea >= Number(nodeRect.width) * Number(nodeRect.height)
  }

  const panBy: Actions['panBy'] = (delta) => {
    const { viewport, dimensions, d3Zoom, d3Selection, translateExtent } = state

    if (!d3Zoom || !d3Selection || (!delta.x && !delta.y)) {
      return false
    }

    const nextTransform = zoomIdentity.translate(viewport.x + delta.x, viewport.y + delta.y).scale(viewport.zoom)

    const extent: CoordinateExtent = [
      [0, 0],
      [dimensions.width, dimensions.height],
    ]

    const constrainedTransform = d3Zoom.constrain()(nextTransform, extent, translateExtent)

    const transformChanged =
      state.viewport.x !== constrainedTransform.x ||
      state.viewport.y !== constrainedTransform.y ||
      state.viewport.zoom !== constrainedTransform.k

    d3Zoom.transform(d3Selection, constrainedTransform)

    return transformChanged
  }

  const setState: Actions['setState'] = (options) => {
    const opts = options instanceof Function ? options(state) : options

    // these options cannot be set after initialization
    const exclude: (keyof typeof opts)[] = [
      'd3Zoom',
      'd3Selection',
      'd3ZoomHandler',
      'viewportRef',
      'vueFlowRef',
      'dimensions',
      'hooks',
    ]

    // we need to set the default opts before setting any elements so the options are applied to the elements on first render
    if (isDef(opts.defaultEdgeOptions)) {
      state.defaultEdgeOptions = opts.defaultEdgeOptions
    }

    const elements = opts.modelValue || opts.nodes || opts.edges ? ([] as Elements) : undefined

    if (elements) {
      if (opts.modelValue) {
        elements.push(...opts.modelValue)
      }

      if (opts.nodes) {
        elements.push(...opts.nodes)
      }

      if (opts.edges) {
        elements.push(...opts.edges)
      }

      setElements(elements)
    }

    const setSkippedOptions = () => {
      if (isDef(opts.maxZoom)) {
        setMaxZoom(opts.maxZoom)
      }
      if (isDef(opts.minZoom)) {
        setMinZoom(opts.minZoom)
      }
      if (isDef(opts.translateExtent)) {
        setTranslateExtent(opts.translateExtent)
      }
    }

    for (const o of Object.keys(opts)) {
      const key = o as keyof State
      const option = opts[key]

      if (![...storeOptionsToSkip, ...exclude].includes(key) && isDef(option)) {
        ;(<any>state)[key] = option
      }
    }

    until(() => state.d3Zoom)
      .not.toBeNull()
      .then(setSkippedOptions)

    if (!state.initialized) {
      state.initialized = true
    }
  }

  const toObject: Actions['toObject'] = () => {
    // we have to stringify/parse so objects containing refs (like nodes and edges) can potentially be saved in a storage
    return JSON.parse(
      JSON.stringify({
        nodes: state.nodes.map((n) => {
          // omit internal properties when exporting
          const {
            computedPosition: _,
            handleBounds: __,
            selected: ___,
            dimensions: ____,
            isParent: _____,
            resizing: ______,
            dragging: _______,
            initialized: ________,
            events: _________,
            ...rest
          } = n

          return rest
        }),
        edges: state.edges.map((e) => {
          // omit internal properties when exporting
          const { selected: _, sourceNode: __, targetNode: ___, events: ____, ...rest } = e

          return rest
        }),
        position: [state.viewport.x, state.viewport.y],
        zoom: state.viewport.zoom,
        viewport: state.viewport,
      } as FlowExportObject),
    )
  }

  const fromObject: Actions['fromObject'] = (obj) => {
    return new Promise((resolve) => {
      const { nodes, edges, position, zoom, viewport } = obj

      if (nodes) {
        setNodes(nodes)
      }

      if (edges) {
        setEdges(edges)
      }

      if ((viewport?.x && viewport?.y) || position) {
        const x = viewport?.x || position[0]
        const y = viewport?.y || position[1]
        const nextZoom = viewport?.zoom || zoom || state.viewport.zoom

        return until(() => viewportHelper.value.viewportInitialized)
          .toBe(true)
          .then(() => {
            viewportHelper.value
              .setViewport({
                x,
                y,
                zoom: nextZoom,
              })
              .then(() => {
                resolve(true)
              })
          })
      } else {
        resolve(true)
      }
    })
  }

  const $reset: Actions['$reset'] = () => {
    const resetState = useState()

    state.edges = []
    state.nodes = []

    // reset the zoom state
    if (state.d3Zoom && state.d3Selection) {
      const updatedTransform = zoomIdentity
        .translate(resetState.defaultViewport.x ?? 0, resetState.defaultViewport.y ?? 0)
        .scale(clamp(resetState.defaultViewport.zoom ?? 1, resetState.minZoom, resetState.maxZoom))

      const bbox = state.viewportRef!.getBoundingClientRect()

      const extent: CoordinateExtent = [
        [0, 0],
        [bbox.width, bbox.height],
      ]

      const constrainedTransform = state.d3Zoom.constrain()(updatedTransform, extent, resetState.translateExtent)
      state.d3Zoom.transform(state.d3Selection, constrainedTransform)
    }

    setState(resetState)
  }

  return {
    updateNodePositions,
    updateNodeDimensions,
    setElements,
    setNodes,
    setEdges,
    addNodes,
    addEdges,
    removeNodes,
    removeEdges,
    findNode,
    findEdge,
    updateEdge,
    updateNode,
    updateNodeData,
    applyEdgeChanges,
    applyNodeChanges,
    addSelectedElements,
    addSelectedNodes,
    addSelectedEdges,
    setMinZoom,
    setMaxZoom,
    setTranslateExtent,
    setNodeExtent,
    removeSelectedElements,
    removeSelectedNodes,
    removeSelectedEdges,
    startConnection,
    updateConnection,
    endConnection,
    setInteractive,
    setState,
    getIntersectingNodes,
    getIncomers,
    getOutgoers,
    getConnectedEdges,
    isNodeIntersecting,
    panBy,
    fitView: (params) => viewportHelper.value.fitView(params),
    zoomIn: (transitionOpts) => viewportHelper.value.zoomIn(transitionOpts),
    zoomOut: (transitionOpts) => viewportHelper.value.zoomOut(transitionOpts),
    zoomTo: (zoomLevel, transitionOpts) => viewportHelper.value.zoomTo(zoomLevel, transitionOpts),
    setViewport: (params, transitionOpts) => viewportHelper.value.setViewport(params, transitionOpts),
    setTransform: (params, transitionOpts) => viewportHelper.value.setTransform(params, transitionOpts),
    getViewport: () => viewportHelper.value.getViewport(),
    getTransform: () => viewportHelper.value.getTransform(),
    setCenter: (x, y, opts) => viewportHelper.value.setCenter(x, y, opts),
    fitBounds: (params, opts) => viewportHelper.value.fitBounds(params, opts),
    project: (params) => viewportHelper.value.project(params),
    screenToFlowCoordinate: (params) => viewportHelper.value.screenToFlowCoordinate(params),
    flowToScreenCoordinate: (params) => viewportHelper.value.flowToScreenCoordinate(params),
    toObject,
    fromObject,
    updateNodeInternals,
    viewportHelper,
    $reset,
    $destroy: () => {},
  }
}
