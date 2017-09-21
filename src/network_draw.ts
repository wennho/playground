import * as nn from "./nn";
import {mode, reset, state, updateUI, DENSITY, xDomain, paramChanged, updateDecisionBoundary, heatMap, boundary} from "./playground"
import {HeatMap} from "./heatmap";

const RECT_SIZE = 30;
const BIAS_SIZE = 5;

enum HoverType {
  BIAS, WEIGHT
}

export interface InputFeature {
  f: (x: number, y: number) => number;
  label?: string;
}

export let INPUTS: {[name: string]: InputFeature} = {
  "x": {f: (x, y) => x, label: "X_1"},
  "y": {f: (x, y) => y, label: "X_2"},
  "xSquared": {f: (x, y) => x * x, label: "X_1^2"},
  "ySquared": {f: (x, y) => y * y,  label: "X_2^2"},
  "xTimesY": {f: (x, y) => x * y, label: "X_1X_2"},
  "sinX": {f: (x, y) => Math.sin(x), label: "sin(X_1)"},
  "sinY": {f: (x, y) => Math.sin(y), label: "sin(X_2)"},
};

export const enum Mode {
  None,
  DeleteEdge,
  AddEdge,
}

export let n: nn.Network = null;
export function setNetwork(network:nn.Network) {
  n = network;
}

// Draw network
export function drawNetwork(n: nn.Network): void {
  let network: nn.Node[][] = n.network;
  let svg = d3.select("#svg");
  // Remove all svg elements.
  svg.select("g.core").remove();
  // Remove all div elements.
  d3.select("#network").selectAll("div.canvas").remove();
  d3.select("#network").selectAll("div.plus-minus-neurons").remove();

  // Get the width of the svg container.
  let padding = 3;
  let co = d3.select(".column.output").node() as HTMLDivElement;
  let cf = d3.select(".column.features").node() as HTMLDivElement;
  let width = co.offsetLeft - cf.offsetLeft;
  svg.attr("width", width);

  // Map of all node coordinates.
  let node2coord: {[id: string]: {cx: number, cy: number}} = {};
  let container = svg.append("g")
    .classed("core", true)
    .attr("transform", `translate(${padding},${padding})`);
  // Draw the network layer by layer.
  let numLayers = n.network.length;
  let featureWidth = 118;
  let layerScale = d3.scale.ordinal<number, number>()
    .domain(d3.range(1, numLayers - 1))
    .rangePoints([featureWidth, width - RECT_SIZE], 0.7);
  let nodeIndexScale = (nodeIndex: number) => nodeIndex * (RECT_SIZE + 25);


  let calloutThumb = d3.select(".callout.thumbnail").style("display", "none");
  let calloutWeights = d3.select(".callout.weights").style("display", "none");
  let idWithCallout = null;
  let targetIdWithCallout = null;

  // Draw the input layer separately.
  let cx = RECT_SIZE / 2 + 50;
  let nodeIds = Object.keys(INPUTS);
  let maxY = nodeIndexScale(nodeIds.length);
  nodeIds.forEach((nodeId, i) => {
    let cy = nodeIndexScale(i) + RECT_SIZE / 2;
    node2coord[nodeId] = {cx, cy};
    drawNode(cx, cy, nodeId, true, container);
  });

  // calculate intermediate node placements
  for (let layerIdx = 1; layerIdx < numLayers - 1; layerIdx++) {
    let numNodes = network[layerIdx].length;
    let cx = layerScale(layerIdx) + RECT_SIZE / 2;
    maxY = Math.max(maxY, nodeIndexScale(numNodes));
    for (let i = 0; i < numNodes; i++) {
      let node = network[layerIdx][i];
      let cy = nodeIndexScale(i) + RECT_SIZE / 2;
      node2coord[node.id] = {cx, cy};
    }
  }

  // Draw the intermediate layers.
  for (let layerIdx = 1; layerIdx < numLayers - 1; layerIdx++) {
    let numNodes = network[layerIdx].length;

    addPlusMinusControl(layerScale(layerIdx), layerIdx);
    for (let i = 0; i < numNodes; i++) {
      let node = network[layerIdx][i];
      let cx = node2coord[node.id].cx;
      let cy = node2coord[node.id].cy;
      drawNode(cx, cy, node.id, false, container, node);

      // Show callout to thumbnails.
      let numNodes = network[layerIdx].length;
      let nextNumNodes = network[layerIdx + 1].length;
      if (idWithCallout == null &&
        i === numNodes - 1 &&
        nextNumNodes <= numNodes) {
        calloutThumb.style({
          display: null,
          top: `${20 + 3 + 13 + cy}px`,
          left: `${cx}px`
        });
        idWithCallout = node.id;
      }
    }
  }

      // Draw links.
  for (let layerIdx = 1; layerIdx < numLayers - 1; layerIdx++) {
    let numNodes = network[layerIdx].length;
    for (let i = 0; i < numNodes; i++) {
      let node = network[layerIdx][i];
      for (let j = 0; j < node.inputLinks.length; j++) {
        let link = node.inputLinks[j];

        let path: SVGPathElement = drawLink(link, node2coord, n.network,
          container, j === 0, j, node.inputLinks.length).node() as any;
        // Show callout to weights.
        let prevLayer = network[layerIdx - 1];
        let lastNodePrevLayer = prevLayer[prevLayer.length - 1];


        // draw callout box
        if (targetIdWithCallout == null &&
          i === numNodes - 1 &&
          link.source.id === lastNodePrevLayer.id &&
          (link.source.id !== idWithCallout || numLayers <= 5) &&
          link.dest.id !== idWithCallout &&
          prevLayer.length >= numNodes) {
          let midPoint = path.getPointAtLength(path.getTotalLength() * 0.7);
          calloutWeights.style({
            display: null,
            top: `${midPoint.y + 5}px`,
            left: `${midPoint.x + 3}px`
          });
          targetIdWithCallout = link.dest.id;
        }
      }
    }
  }

  // Output node is drawn separately
  cx = width + RECT_SIZE / 2;
  let node = network[numLayers - 1][0];

  // add click listener
  d3.select('#heatmap').on('click', function(){
    if (mode == Mode.AddEdge) {
      selectNode(d3.select('#heatmap'), node);
    }
  });

  let cy = nodeIndexScale(0) + RECT_SIZE / 2;
  node2coord[node.id] = {cx, cy};
  // Draw links.
  for (let i = 0; i < node.inputLinks.length; i++) {
    let link = node.inputLinks[i];
    drawLink(link, node2coord, n.network, container, i === 0, i,
      node.inputLinks.length);
  }
  // Adjust the height of the svg.
  svg.attr("height", maxY);

  // Adjust the height of the features column.
  let height = Math.max(
    getRelativeHeight(calloutThumb),
    getRelativeHeight(calloutWeights),
    getRelativeHeight(d3.select("#network"))
  );
  d3.select(".column.features").style("height", height + "px");
}



function getRelativeHeight(selection: d3.Selection<any>) {
  let node = selection.node() as HTMLAnchorElement;
  return node.offsetHeight + node.offsetTop;
}

function addPlusMinusControl(x: number, layerIdx: number) {
  let div = d3.select("#network").append("div")
    .classed("plus-minus-neurons", true)
    .style("left", `${x - 10}px`);

  let i = layerIdx - 1;
  let firstRow = div.append("div").attr("class", `ui-numNodes${layerIdx}`);
  firstRow.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      let numNeurons = state.networkShape[i];
      if (numNeurons >= 8) {
        return;
      }
      n.addNode(i+1);
      paramChanged();
      reset();
    })
    .append("i")
    .attr("class", "material-icons")
    .text("add");

  firstRow.append("button")
    .attr("class", "mdl-button mdl-js-button mdl-button--icon")
    .on("click", () => {
      let numNeurons = state.networkShape[i];
      if (numNeurons <= 1) {
        return;
      }
      n.removeNode(n.network[i+1][0]); // remove the first node
      paramChanged();
      reset();
    })
    .append("i")
    .attr("class", "material-icons")
    .text("remove");

  let suffix = state.networkShape[i] > 1 ? "s" : "";
  div.append("div").text(
    state.networkShape[i] + " neuron" + suffix
  );
}

function updateHoverCard(type: HoverType, nodeOrLink?: nn.Node | nn.Link,
                         coordinates?: [number, number]) {
  let hovercard = d3.select("#hovercard");
  if (type == null) {
    hovercard.style("display", "none");
    d3.select("#svg").on("click", null);
    return;
  }

  // actions when the node or link is clicked
  d3.select("#svg").on("click", () => {

    if (mode === Mode.DeleteEdge && nodeOrLink instanceof nn.Link) {
      n.removeLink(nodeOrLink);
      let hovercard = d3.select("#hovercard");
      hovercard.style("display", "none");
      d3.select("#svg").on("click", null);
      reset();
      return;
    }

    hovercard.select(".value").style("display", "none");
    let input = hovercard.select("input");
    input.style("display", null);
    input.on("input", function() {
      if (this.value != null && this.value !== "") {
        if (type === HoverType.WEIGHT) {
          (nodeOrLink as nn.Link).weight = +this.value;
        } else {
          (nodeOrLink as nn.Node).bias = +this.value;
        }
        updateUI();
      }
    });
    input.on("keypress", () => {
      if ((d3.event as any).keyCode === 13) {
        updateHoverCard(type, nodeOrLink, coordinates);
      }
    });
    (input.node() as HTMLInputElement).focus();
  });
  let value = (type === HoverType.WEIGHT) ?
    (nodeOrLink as nn.Link).weight :
    (nodeOrLink as nn.Node).bias;
  let error = (type === HoverType.WEIGHT) ?
    (nodeOrLink as nn.Link).error :
    (nodeOrLink as nn.Node).error;
  let name = (type === HoverType.WEIGHT) ? "Weight" : "Bias";
  hovercard.style({
    "left": `${coordinates[0] + 20}px`,
    "top": `${coordinates[1]}px`,
    "display": "block"
  });
  hovercard.select(".type").text(name);
  hovercard.select(".value")
    .style("display", null)
    .text(value.toPrecision(2));
  hovercard.select(".error-value")
    .style("display", null)
    .text((error*100).toPrecision(3));
  hovercard.select("input")
    .property("value", value.toPrecision(2))
    .style("display", "none");
}

function drawLink(
  input: nn.Link, node2coord: {[id: string]: {cx: number, cy: number}},
  network: nn.Node[][], container: d3.Selection<any>,
  isFirst: boolean, index: number, length: number) {
  let line = container.insert("path", ":first-child");
  let source = node2coord[input.source.id];
  let dest = node2coord[input.dest.id];
  let datum = {
    source: {
      y: source.cx + RECT_SIZE / 2 + 2,
      x: source.cy
    },
    target: {
      y: dest.cx - RECT_SIZE / 2,
      x: dest.cy + ((index - (length - 1) / 2) / length) * 12
    }
  };
  let diagonal = d3.svg.diagonal().projection(d => [d.y, d.x]);

  // back-most line to show error rate
  line.attr({
    "d" : diagonal(datum, 0),
    class: "errorlink",
    id: "errorline" + input.source.id + "-" + input.dest.id,
  });

  // line to show weights
  container.append("path").attr({
    "marker-start": "url(#markerArrow)",
    class: "link",
    id: "link" + input.source.id + "-" + input.dest.id,
    d: diagonal(datum, 0)
  });


  // Add an invisible thick link that will be used for showing the weight value on hover.
  // This has to be last so that it's on top.
  container.append("path")
    .attr("d", diagonal(datum, 0))
    .attr("class", "link-hover")
    .on("mouseenter", function() {
      updateHoverCard(HoverType.WEIGHT, input, d3.mouse(this));
    }).on("mouseleave", function() {
    updateHoverCard(null);
  });

  return line;
}

let selectedNode : nn.Node = null;
let selectedDiv = null;
export let selectedNodeId: string = null;

function selectNode(div, node) {
  if (selectedNode == null) {
    selectedNode = node;
    selectedDiv = div;
    div.classed("selected", true);
    d3.select('#info').text('Node ' + node.id + ' selected. Click on another node to create a link.');
  } else if (selectedNode.id == node.id) {
    selectedNode = null;
    selectedDiv = null;
    div.classed("selected", false);
    d3.select('#info').text('Node ' + node.id + ' unselected.');
  } else {
    // first check that link does not already exist
    if (selectedNode.layer == node.layer || selectedNode.isLinked(node)) {
      d3.select('#info').text('Cannot create link. Invalid target.');
      return;
    }

    let fromNode = selectedNode.layer < node.layer ? selectedNode : node;
    let toNode = selectedNode.layer > node.layer ? selectedNode : node;
    n.addLink(fromNode, toNode);
    d3.select('#info').text('Link between nodes ' + node.id + ' and ' + selectedNode.id + ' created.');
    selectedNode = null;
    selectedDiv.classed("selected", false);
    selectedDiv = null;
    reset();
  }
}


function drawNode(cx: number, cy: number, nodeId: string, isInput: boolean,
                  container: d3.Selection<any>, node?: nn.Node) {
  let x = cx - RECT_SIZE / 2;
  let y = cy - RECT_SIZE / 2;

  let nodeGroup = container.append("g")
    .attr({
      "class": "node",
      "id": `node${nodeId}`,
      "transform": `translate(${x},${y})`
    });

  // Draw the main rectangle.
  nodeGroup.append("rect")
    .attr({
      x: 0,
      y: 0,
      width: RECT_SIZE,
      height: RECT_SIZE,
    });
  let activeOrNotClass = state[nodeId] ? "active" : "inactive";

  if (isInput) {
    let label = INPUTS[nodeId].label != null ?
      INPUTS[nodeId].label : nodeId;
    // Draw the input label.
    let text = nodeGroup.append("text").attr({
      class: "main-label",
      x: -10,
      y: RECT_SIZE / 2,
      "text-anchor": "end"
    });
    if (/[_^]/.test(label)) {
      let myRe = /(.*?)([_^])(.)/g;
      let myArray;
      let lastIndex;
      while ((myArray = myRe.exec(label)) != null) {
        lastIndex = myRe.lastIndex;
        let prefix = myArray[1];
        let sep = myArray[2];
        let suffix = myArray[3];
        if (prefix) {
          text.append("tspan").text(prefix);
        }
        text.append("tspan")
          .attr("baseline-shift", sep === "_" ? "sub" : "super")
          .style("font-size", "9px")
          .text(suffix);
      }
      if (label.substring(lastIndex)) {
        text.append("tspan").text(label.substring(lastIndex));
      }
    } else {
      text.append("tspan").text(label);
    }
    nodeGroup.classed(activeOrNotClass, true);
  }

  if (!isInput) {
    // draw the option labels
    let text = nodeGroup.append("text").attr({
      class: "option-label",
      x: 0,
      y: RECT_SIZE + 13,
      "text-anchor": "start"
    });
    text.append("tspan").text('Remove');
    text.on("click", function() {
      n.removeNode(node);
      paramChanged();
      reset();
    });
    text.style("cursor", "pointer");


    let errorText = nodeGroup.append("text").attr({
      class: "option-label",
      id: `error-${nodeId}`,
      x: RECT_SIZE + 7,
      y: RECT_SIZE - 4,
      "text-anchor": "start"
    });
    errorText.text('Error:');

  }

  if (!isInput) {
    // Draw the node's bias.
    nodeGroup.append("rect")
      .attr({
        id: `bias-${nodeId}`,
        x: -BIAS_SIZE - 2,
        y: RECT_SIZE - BIAS_SIZE + 3,
        width: BIAS_SIZE,
        height: BIAS_SIZE,
      }).on("mouseenter", function() {
      updateHoverCard(HoverType.BIAS, node, d3.mouse(container.node()));
    }).on("mouseleave", function() {
      updateHoverCard(null);
    });
  }

  // Draw the node's canvas.
  let div = d3.select("#network").insert("div", ":first-child")
    .attr({
      "id": `canvas-${nodeId}`,
      "class": "canvas"
    })
    .style({
      position: "absolute",
      left: `${x + 3}px`,
      top: `${y + 3}px`
    })
    .on("mouseenter", function() {
      selectedNodeId = nodeId;
      div.classed("hovered", true);
      nodeGroup.classed("hovered", true);
      updateDecisionBoundary(n.network, false);
      heatMap.updateBackground(boundary[nodeId], state.discretize);
    })
    .on("mouseleave", function() {
      selectedNodeId = null;
      div.classed("hovered", false);
      nodeGroup.classed("hovered", false);
      updateDecisionBoundary(n.network, false);
      heatMap.updateBackground(boundary[n.getOutputNode().id],
        state.discretize);
    })
    .on("click", function(){
      if (mode == Mode.AddEdge) {
        selectNode(div, node);
      }
    });

  if (isInput) {
    div.on("click", function() {

      if (mode == Mode.AddEdge) {
        selectNode(div, n.findNode(nodeId));
        return;
      }

      // add or remove input node
      state[nodeId] = !state[nodeId];
      paramChanged();

      if (state[nodeId]) {
        n.addInput(nodeId);
      } else {
        n.removeNode(n.findNode(nodeId));
      }

      reset();
    });
    div.style("cursor", "pointer");
  }
  if (isInput) {
    div.classed(activeOrNotClass, true);
  }
  let nodeHeatMap = new HeatMap(RECT_SIZE, DENSITY / 10, xDomain,
    xDomain, div, {noSvg: true});
  div.datum({heatmap: nodeHeatMap, id: nodeId});

}