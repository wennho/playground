/* Copyright 2016 Google Inc. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/

export class Network {
  network: Node[][];
  nextNodeId: number;
  activation: ActivationFunction;
  initZero:boolean;
  regularization:RegularizationFunction;
  longLinks: Link[];
  node2layer: {[id:string]:number} = {};
  id2node:{[id:string]:Node} = {};

  /**
   * Builds a neural network.
   *
   * @param networkShape The shape of the network. E.g. [1, 2, 3, 1] means
   *   the network will have one input node, 2 nodes in first hidden layer,
   *   3 nodes in second hidden layer and 1 output node.
   * @param activation The activation function of every hidden node.
   * @param outputActivation The activation function for the output nodes.
   * @param regularization The regularization function that computes a penalty
   *     for a given weight (parameter) in the network. If null, there will be
   *     no regularization.
   * @param inputIds List of ids for the input nodes.
   * @param initZero
   */
  constructor(
      networkShape: number[], activation: ActivationFunction,
      outputActivation: ActivationFunction,
      regularization: RegularizationFunction,
      inputIds: string[], initZero?: boolean) {
      let numLayers = networkShape.length;
      this.nextNodeId = 1;
      /** List of layers, with each layer being a list of nodes. */
      this.network = [];
      this.initZero = initZero;
      this.activation = activation;
      this.regularization = regularization;
      this.longLinks = [];

      for (let layerIdx = 0; layerIdx < numLayers; layerIdx++) {
          let isOutputLayer = layerIdx === numLayers - 1;
          let isInputLayer = layerIdx === 0;
          let currentLayer: Node[] = [];
          this.network .push(currentLayer);
          let numNodes = networkShape[layerIdx];
          for (let i = 0; i < numNodes; i++) {
              let nodeId = this.nextNodeId.toString();
              if (isInputLayer) {
                  nodeId = inputIds[i];
              } else {
                  this.nextNodeId++;
              }
              let node = new Node(nodeId,
                  isOutputLayer ? outputActivation : activation, initZero);
              currentLayer.push(node);
              this.node2layer[nodeId] = layerIdx;
              this.id2node[nodeId] = node;

              if (layerIdx >= 1) {
                  // Add links from nodes in the previous layer to this node.
                  for (let j = 0; j < this.network [layerIdx - 1].length; j++) {
                      let prevNode = this.network [layerIdx - 1][j];
                      let link = new Link(prevNode, node, regularization, this);
                      prevNode.outputs.push(link);
                      node.inputLinks.push(link);
                  }
              }
          }
      }
  }

  getShape() : number[] {
    let shape = [];
    for (let i=1; i<this.network.length-1; i++) { // we can skip the input and output layers
        shape.push(this.network[i].length);
    }
    return shape;
  }

  removeLayer(layerIdx:number){
    if (layerIdx < 1 || layerIdx >= this.network.length-1) {
      throw new Error ("Cannot remove layer - index out of bounds");
    }

    while (this.network[layerIdx].length > 0){
        this.removeNode(this.network[layerIdx][0]);
    }

    this.network.splice(layerIdx,1);
    this.recomputeLayers();
  }

  // layerIdx will be the index of the new layer
  addLayer(layerIdx:number){
    this.network.splice(layerIdx,0,[]);
    this.addNode(layerIdx);
    this.recomputeLayers();
  }


  removeNode(node: Node) {

    // Remove links
    // use while loop because the link array is changing each iteration
    while (node.inputLinks.length > 0) {
      this.removeLink(node.inputLinks[0]);
    }

    while (node.outputs.length > 0) {
      this.removeLink(node.outputs[0]);
    }

    // remove node from network
    delete this.id2node[node.id];
    let layerIdx = this.node2layer[node.id];
    let index = this.network[layerIdx].map(function(x) {return x.id; }).indexOf(node.id);
    if (index > -1) {
      this.network[layerIdx].splice(index, 1);
    } else {
      throw new Error ("cannot find node to remove");
    }

  }

  findNode(nodeId: string) {

    for (let i=0; i<this.network.length; i++) {
      let index = this.network[i].map((x) => {return x.id; }).indexOf(nodeId);
      if (index > -1) {
        return this.network[i][index];
      }
    }
    throw new Error ("cannot find node");
  }

  // layer 0 corresponds to the input layer. Returns the node created
  addNode(layer:number) {
      this.nextNodeId++;

      let node = new Node(this.nextNodeId.toString(), this.activation, this.initZero);
      this.network[layer].push(node);
      this.node2layer[node.id] = layer;
      this.id2node[node.id] = node;

      // Add links from nodes in the previous layer to this node.
      for (let j = 0; j < this.network [layer-1].length; j++) {
          let prevNode = this.network [layer-1][j];
          this.addLink(prevNode,node);
      }

      // add links from the next layer to this node
      for (let j = 0; j < this.network [layer+1].length; j++) {
          let nextNode = this.network [layer+1][j];
          this.addLink(node,nextNode);
      }

      return node;
  }

  addInput(nodeId) {
    let node = new Node(nodeId, this.activation, this.initZero);
    this.network[0].push(node);
    this.node2layer[nodeId] = 0;
    for (let i=0; i<this.network[1].length; i++) {
      this.addLink(node, this.network[1][i]);
    }
  }

  // assumes node2layer is accurate
  recomputeLongLinks() {
    this.longLinks = [];
    this.network.forEach((layer)=>{
      layer.forEach((node)=>{
        node.outputs.forEach((link)=>{
          if (link.isLong()) {
            this.longLinks.push(link);
          }
        }, this);
      }, this);
    }, this);
  }

  // populate new network layers, using the old network as reference for ordering
  // orphaned nodes are returned in an array
  assignLayers(id2layer, newNetwork) {
    let toVisit = [];
    for (let i=0; i<this.network.length; i++){
      let layer = this.network[i];
      for (let j=0; j<layer.length;j++) {
        let node = layer[j];
        if (id2layer.hasOwnProperty(node.id)) {
          let layerIdx = id2layer[node.id];
          while (newNetwork.length <= layerIdx) {
            newNetwork.push([]);
          }
          newNetwork[layerIdx].push(node);
        } else {

          if (node.inputLinks.length == 0) {
            // this node has no inputs. Place it for visiting again.
            toVisit.push(node);
          }
        }
      }
    }
    return toVisit;
  }

  // assumes that input layers are on the first layer
  recomputeLayers() {

    let toVisit : Node[] = this.network[0];
    let toVisitNext : Node[];
    let currentLayer = 0;
    let id2layer = {};
    let newNetwork;

    // assign layers via breadth-first traversal from input nodes
    while (toVisit.length > 0) {

      while (toVisit.length > 0) {
        toVisitNext = [];
        for (let i = 0; i < toVisit.length; i++) {
          let node = toVisit[i];

          if (!id2layer.hasOwnProperty(node.id) || id2layer[node.id] < currentLayer) {
            id2layer[node.id] = currentLayer;
          }

          node.outputs.forEach((link: Link) => {
            toVisitNext.push(link.dest);
          });
        }
        toVisit = toVisitNext;
        currentLayer++;
        if (currentLayer > 10) {
          throw new Error("Too many layers");
        }
      }

      newNetwork = [];
      // populate new network layers, using the old network as reference for ordering
      // orphaned nodes are returned in an array
      toVisit = this.assignLayers(id2layer, newNetwork);
      let outputNodeID=this.getOutputNode().id;

      // ensure orphaned nodes are always at the highest layer,
      // but also check that there are no empty intermediate layers.
      // if the output node has been assigned a layer, place orphaned nodes at an optimal level
      // otherwise, place it at the next higher layer that hasn't been assigned
      if (id2layer.hasOwnProperty(outputNodeID)) {
        currentLayer = id2layer[outputNodeID];
      }
    }


    this.node2layer = id2layer;
    this.network = newNetwork;

    this.recomputeLongLinks();
  }

  addLink(fromNode:Node, toNode:Node) {

    let link = new Link(fromNode, toNode, this.regularization, this);
    fromNode.outputs.push(link);
    toNode.inputLinks.push(link);
    if (link.isLong()) {
      this.longLinks.push(link);
    }

  }

  removeLink(link:Link) {

    if (link.isLong()) {
      this.longLinks = this.longLinks.filter(function(x) {return x.id !== link.id; });
    }

    let node = link.source;
    let origLength = node.outputs.length;
    node.outputs = node.outputs.filter(function(x) {return x.id !== link.id; });
    if (node.outputs.length !== origLength - 1 ) {
      throw new Error('Unable to remove output node - node not found');
    }

    node = link.dest;
    origLength = node.inputLinks.length;
    node.inputLinks = node.inputLinks.filter(function(x) {return x.id !== link.id });
    if (node.inputLinks.length !== origLength -1 ) {
      throw new Error('Unable to remove input node - node not found');
    }

  }

  /** Iterates over every node in the network/ */
  // ignoreInputs - ignore input layer
  forEachNode(ignoreInputs: boolean, accessor: (node: Node) => any) {
    for (let layerIdx = ignoreInputs ? 1 : 0;
         layerIdx < this.network.length;
         layerIdx++) {
      let currentLayer = this.network[layerIdx];
      for (let i = 0; i < currentLayer.length; i++) {
        let node = currentLayer[i];
        accessor(node);
      }
    }
  }

  /** Returns the output node in the network. */
  getOutputNode() {
    return this.network[this.network.length - 1][0];
  }

}

/**
 * A node in a neural network. Each node has a state
 * (total input, output, and their respectively derivatives) which changes
 * after every forward and back propagation run.
 */
export class Node {
  id: string;
  /** List of input links. */
  inputLinks: Link[] = [];
  bias = 0.1;
  /** List of output links. */
  outputs: Link[] = [];
  totalInput: number;
  output: number;
  /** Error derivative with respect to this node's output. */
  outputDer = 0;
  /** Error derivative with respect to this node's total input. */
  inputDer = 0;
  /**
   * Accumulated error derivative with respect to this node's total input since
   * the last update. This derivative equals dE/db where b is the node's
   * bias term.
   */
  accInputDer = 0;
  /**
   * Number of accumulated err. derivatives with respect to the total input
   * since the last update.
   */
  numAccumulatedDers = 0;
  /** Activation function that takes total input and returns node's output */
  activation: ActivationFunction;

  // Saved error statistics
  error = 0;
  accError = 0;
  currError = 0;

  /**
   * Creates a new node with the provided id and activation function.
   */
  constructor(id: string, activation: ActivationFunction, initZero?: boolean) {
    this.id = id;
    this.activation = activation;
    if (initZero) {
      this.bias = 0;
    }
  }

  /** Recomputes the node's output and returns it. */
  updateOutput(): number {
    // Stores total input into the node.
    this.totalInput = this.bias;
    for (let j = 0; j < this.inputLinks.length; j++) {
      let link = this.inputLinks[j];
      this.totalInput += link.weight * link.source.output;
    }
    this.output = this.activation.output(this.totalInput);
    return this.output;
  }


  isLinked(node: Node): boolean {
    let index = this.outputs.map(function(x) {return x.dest.id; }).indexOf(node.id);
    if (index > -1) {
      return true;
    }
    index = this.inputLinks.map(function(x) {return x.source.id; }).indexOf(node.id);
    return index > -1;

  }
}

/**
 * An error function and its derivative.
 */
export interface ErrorFunction {
  error: (output: number, target: number) => number;
  der: (output: number, target: number) => number;
}

/** A node's activation function and its derivative. */
export interface ActivationFunction {
  output: (input: number) => number;
  der: (input: number) => number;
}

/** Function that computes a penalty cost for a given weight in the network. */
export interface RegularizationFunction {
  output: (weight: number) => number;
  der: (weight: number) => number;
}

/** Built-in error functions */
export class Errors {
  public static SQUARE: ErrorFunction = {
    error: (output: number, target: number) =>
               0.5 * Math.pow(output - target, 2),
    der: (output: number, target: number) => output - target
  };
}

/** Polyfill for TANH */
(Math as any).tanh = (Math as any).tanh || function(x) {
  if (x === Infinity) {
    return 1;
  } else if (x === -Infinity) {
    return -1;
  } else {
    let e2x = Math.exp(2 * x);
    return (e2x - 1) / (e2x + 1);
  }
};

/** Built-in activation functions */
export class Activations {
  public static TANH: ActivationFunction = {
    output: x => (Math as any).tanh(x),
    der: x => {
      let output = Activations.TANH.output(x);
      return 1 - output * output;
    }
  };
  public static RELU: ActivationFunction = {
    output: x => Math.max(0, x),
    der: x => x <= 0 ? 0 : 1
  };
  public static SIGMOID: ActivationFunction = {
    output: x => 1 / (1 + Math.exp(-x)),
    der: x => {
      let output = Activations.SIGMOID.output(x);
      return output * (1 - output);
    }
  };
  public static LINEAR: ActivationFunction = {
    output: x => x,
    der: x => 1
  };
}

/** Build-in regularization functions */
export class RegularizationFunction {
  public static L1: RegularizationFunction = {
    output: w => Math.abs(w),
    der: w => w < 0 ? -1 : (w > 0 ? 1 : 0)
  };
  public static L2: RegularizationFunction = {
    output: w => 0.5 * w * w,
    der: w => w
  };
}

/**
 * A link in a neural network. Each link has a weight and a source and
 * destination node. Also it has an internal state (error derivative
 * with respect to a particular input) which gets updated after
 * a run of back propagation.
 */
export class Link {

  static id2Link:{[id:string]:Link} = {};
  id: string;
  source: Node;
  dest: Node;
  weight = Math.random() - 0.5;
  isDead = false;
  /** Error derivative with respect to this weight. */
  errorDer = 0;
  /** Accumulated error derivative since the last update. */
  accErrorDer = 0;
  /** Number of accumulated derivatives since the last update. */
  numAccumulatedDers = 0;
  regularization: RegularizationFunction;
  error = 0;
  accError = 0;
  currError = 0;
  network : Network;

  /**
   * Constructs a link in the neural network initialized with random weight.
   *
   * @param source The source node.
   * @param dest The destination node.
   * @param regularization The regularization function that computes the
   *     penalty for this weight. If null, there will be no regularization.
   * @param n The network
   */
  constructor(source: Node, dest: Node,
      regularization: RegularizationFunction, n:Network) {

    // check link does not already exist
    if (source.isLinked(dest)) {
      throw new Error("Cannot create duplicate link");
    }

    this.id = source.id + "-" + dest.id;
    this.source = source;
    this.dest = dest;
    this.regularization = regularization;
    this.network = n;
    if (n.initZero) {
      this.weight = 0;
    }
    Link.id2Link[this.id] = this;
  }

  isLong() : boolean {
    let n2l = this.network.node2layer;
    return n2l[this.dest.id] - n2l[this.source.id] > 1;
  }

  sourceLayer() :number {
   return this.network.node2layer[this.source.id];
  }

  destLayer() :number {
    return this.network.node2layer[this.dest.id];
  }

}


/**
 * Runs a forward propagation of the provided input through the provided
 * network. This method modifies the internal state of the network - the
 * total input and output of each node in the network.
 *
 * @param network The neural network.
 * @param inputs The input array. Its length should match the number of input
 *     nodes in the network.
 * @return The final output of the network.
 */
export function forwardProp(network: Node[][], inputs: number[]): number {
  let inputLayer = network[0];
  if (inputs.length !== inputLayer.length) {
    throw new Error("The number of inputs must match the number of nodes in" +
        " the input layer");
  }
  // Update the input layer.
  for (let i = 0; i < inputLayer.length; i++) {
    let node = inputLayer[i];
    node.output = inputs[i];
  }
  for (let layerIdx = 1; layerIdx < network.length; layerIdx++) {
    let currentLayer = network[layerIdx];
    // Update all the nodes in this layer.
    for (let i = 0; i < currentLayer.length; i++) {
      let node = currentLayer[i];
      node.updateOutput();
    }
  }
  return network[network.length - 1][0].output;
}

/**
 * Runs a backward propagation using the provided target and the
 * computed output of the previous call to forward propagation.
 * This method modifies the internal state of the network - the error
 * derivatives with respect to each node, and each weight
 * in the network.
 */
export function backProp(network: Node[][], target: number,
    errorFunc: ErrorFunction): void {
  // The output node is a special case. We use the user-defined error
  // function for the derivative.
  let outputNode = network[network.length - 1][0];
  outputNode.outputDer = errorFunc.der(outputNode.output, target);
  outputNode.currError = Math.abs(outputNode.output - target);
  outputNode.accError += outputNode.currError;

  // Go through the layers backwards.
  for (let layerIdx = network.length - 1; layerIdx >= 1; layerIdx--) {
    let currentLayer = network[layerIdx];
    // Compute the error derivative of each node with respect to:
    // 1) its total input
    // 2) each of its input weights.
    for (let i = 0; i < currentLayer.length; i++) {
      let node = currentLayer[i];
      node.inputDer = node.outputDer * node.activation.der(node.totalInput);
      node.accInputDer += node.inputDer;
      node.numAccumulatedDers++;
    }

    // Error derivative with respect to each weight coming into the node.
    for (let i = 0; i < currentLayer.length; i++) {
      let node = currentLayer[i];

      let weightSum = node.inputLinks.reduce(function (prev, curr) {
        return prev + Math.abs(curr.weight);
      }, 0);

      for (let j = 0; j < node.inputLinks.length; j++) {
        let link = node.inputLinks[j];
        if (link.isDead) {
          link.currError = 0;
          continue;
        }
        link.errorDer = node.inputDer * link.source.output;
        link.accErrorDer += link.errorDer;
        link.numAccumulatedDers++;

        link.currError = node.currError * Math.abs(link.weight) / weightSum;
        link.accError += link.currError;
      }


    }
    if (layerIdx === 1) {
      continue;
    }
    let prevLayer = network[layerIdx - 1];
    for (let i = 0; i < prevLayer.length; i++) {
      let node = prevLayer[i];
      // Compute the error derivative with respect to each node's output.
      node.outputDer = 0;
      node.currError = 0;
      for (let j = 0; j < node.outputs.length; j++) {
        let output = node.outputs[j];
        node.outputDer += output.weight * output.dest.inputDer;
        node.currError += output.currError;
      }
      node.accError += node.currError;
    }
  }
}

/**
 * Updates the weights of the network using the previously accumulated error
 * derivatives.
 */
export function updateWeights(network: Node[][], learningRate: number,
    regularizationRate: number) {
  for (let layerIdx = 1; layerIdx < network.length; layerIdx++) {
    let currentLayer = network[layerIdx];
    for (let i = 0; i < currentLayer.length; i++) {
      let node = currentLayer[i];
      // Update the node's bias.
      if (node.numAccumulatedDers > 0) {
        node.error = node.accError / node.numAccumulatedDers;
        node.bias -= learningRate * node.accInputDer / node.numAccumulatedDers;
        node.accInputDer = 0;
        node.accError = 0;
        node.numAccumulatedDers = 0;
      }
      // Update the weights coming into this node.
      for (let j = 0; j < node.inputLinks.length; j++) {
        let link = node.inputLinks[j];
        if (link.isDead) {
          continue;
        }
        let regulDer = link.regularization ?
            link.regularization.der(link.weight) : 0;
        if (link.numAccumulatedDers > 0) {
          link.error = link.accError / link.numAccumulatedDers;
          // Update the weight based on dE/dw.
          link.weight = link.weight - learningRate * link.accErrorDer / link.numAccumulatedDers;
          // Further update the weight based on regularization.
          let newLinkWeight = link.weight -
              (learningRate * regularizationRate) * regulDer;
          if (link.regularization === RegularizationFunction.L1 &&
              link.weight * newLinkWeight < 0) {
            // The weight crossed 0 due to the regularization term. Set it to 0.
            link.weight = 0;
            link.isDead = true;
          } else {
            link.weight = newLinkWeight;
          }
          link.accErrorDer = 0;
          link.accError = 0;
          link.numAccumulatedDers = 0;
        }
      }
    }
  }
}

