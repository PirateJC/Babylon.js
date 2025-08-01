import type { Nullable } from "../types";
import type { Scene } from "../scene";
import { Color3, Color4 } from "../Maths/math.color";
import type { Node } from "../node";
import { VertexBuffer } from "../Buffers/buffer";
import type { SubMesh } from "../Meshes/subMesh";
import { Mesh } from "../Meshes/mesh";
import { InstancedMesh } from "../Meshes/instancedMesh";
import { Material } from "../Materials/material";
import type { IShaderMaterialOptions } from "../Materials/shaderMaterial";
import { ShaderMaterial } from "../Materials/shaderMaterial";
import type { Effect } from "../Materials/effect";
import type { MeshCreationOptions } from "./mesh";
import { ShaderLanguage } from "core/Materials/shaderLanguage";

Mesh._LinesMeshParser = (parsedMesh: any, scene: Scene): Mesh => {
    return LinesMesh.Parse(parsedMesh, scene);
};

/**
 * Line mesh
 * @see https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param
 */
export class LinesMesh extends Mesh {
    /**
     * Force all the LineMeshes to compile their default color material to glsl even on WebGPU engines.
     * False by default. This is mostly meant for backward compatibility.
     */
    public static ForceGLSL = false;

    /**
     * Color of the line (Default: White)
     */
    public color = new Color3(1, 1, 1);

    /**
     * Alpha of the line (Default: 1)
     */
    public alpha = 1;

    /**
     * The intersection Threshold is the margin applied when intersection a segment of the LinesMesh with a Ray.
     * This margin is expressed in world space coordinates, so its value may vary.
     * Default value is 0.1
     */
    public intersectionThreshold: number;

    private _isShaderMaterial(shader: Nullable<Material>): shader is ShaderMaterial {
        if (!shader) {
            return false;
        }

        return shader.getClassName() === "ShaderMaterial";
    }

    private _color4: Color4;

    /** Shader language used by the material */
    protected _shaderLanguage = ShaderLanguage.GLSL;

    /**
     * Creates a new LinesMesh
     * @param name defines the name
     * @param scene defines the hosting scene
     * @param parent defines the parent mesh if any
     * @param source defines the optional source LinesMesh used to clone data from
     * @param doNotCloneChildren When cloning, skip cloning child meshes of source, default False.
     * When false, achieved by calling a clone(), also passing False.
     * This will make creation of children, recursive.
     * @param useVertexColor defines if this LinesMesh supports vertex color
     * @param useVertexAlpha defines if this LinesMesh supports vertex alpha
     * @param material material to use to draw the line. If not provided, will create a new one
     */
    constructor(
        name: string,
        scene: Nullable<Scene> = null,
        parent: Nullable<Node> = null,
        source: Nullable<LinesMesh> = null,
        doNotCloneChildren?: boolean,
        /**
         * If vertex color should be applied to the mesh
         */
        public readonly useVertexColor?: boolean,
        /**
         * If vertex alpha should be applied to the mesh
         */
        public readonly useVertexAlpha?: boolean,
        material?: Material
    ) {
        super(name, scene, parent, source, doNotCloneChildren);

        if (source) {
            this.color = source.color.clone();
            this.alpha = source.alpha;
            this.useVertexColor = source.useVertexColor;
            this.useVertexAlpha = source.useVertexAlpha;
        }

        this.intersectionThreshold = 0.1;

        const defines: string[] = [];
        const options: Partial<IShaderMaterialOptions> = {
            attributes: [VertexBuffer.PositionKind],
            uniforms: ["world", "viewProjection"],
            needAlphaBlending: true,
            defines: defines,
            useClipPlane: null,
            shaderLanguage: ShaderLanguage.GLSL,
        };

        if (!this.useVertexAlpha) {
            options.needAlphaBlending = false;
        } else {
            options.defines!.push("#define VERTEXALPHA");
        }

        if (!this.useVertexColor) {
            options.uniforms!.push("color");
            this._color4 = new Color4();
        } else {
            options.defines!.push("#define VERTEXCOLOR");
            options.attributes!.push(VertexBuffer.ColorKind);
        }

        if (material) {
            this.material = material;
        } else {
            const engine = this.getScene().getEngine();

            if (engine.isWebGPU && !LinesMesh.ForceGLSL) {
                this._shaderLanguage = ShaderLanguage.WGSL;
            }

            options.shaderLanguage = this._shaderLanguage;
            options.extraInitializationsAsync = async () => {
                if (this._shaderLanguage === ShaderLanguage.WGSL) {
                    await Promise.all([import("../ShadersWGSL/color.vertex"), import("../ShadersWGSL/color.fragment")]);
                } else {
                    await Promise.all([import("../Shaders/color.vertex"), import("../Shaders/color.fragment")]);
                }
            };

            this.material = new ShaderMaterial("colorShader", this.getScene(), "color", options, false);
            this.material.doNotSerialize = true;
        }
    }

    /**
     * @returns the string "LineMesh"
     */
    public override getClassName(): string {
        return "LinesMesh";
    }

    /**
     * @internal
     */
    public override get material(): Nullable<Material> {
        return this._internalAbstractMeshDataInfo._material as Material;
    }

    /**
     * @internal
     */
    public override set material(value: Nullable<Material>) {
        this._setMaterial(value);
        if (this.material) {
            this.material.fillMode = Material.LineListDrawMode;
        }
    }

    /**
     * @internal
     */
    public override get checkCollisions(): boolean {
        return false;
    }

    public override set checkCollisions(value: boolean) {
        // Just ignore it
    }

    /**
     * @internal
     */
    public override _bind(_subMesh: SubMesh, colorEffect: Effect): Mesh {
        if (!this._geometry) {
            return this;
        }

        // VBOs
        const indexToBind = this.isUnIndexed ? null : this._geometry.getIndexBuffer();
        if (!this._userInstancedBuffersStorage || this.hasThinInstances) {
            this._geometry._bind(colorEffect, indexToBind);
        } else {
            this._geometry._bind(colorEffect, indexToBind, this._userInstancedBuffersStorage.vertexBuffers, this._userInstancedBuffersStorage.vertexArrayObjects);
        }

        // Color
        if (!this.useVertexColor && this._isShaderMaterial(this.material)) {
            const { r, g, b } = this.color;
            this._color4.set(r, g, b, this.alpha);
            this.material.setColor4("color", this._color4);
        }

        return this;
    }

    /**
     * @internal
     */
    public override _draw(subMesh: SubMesh, fillMode: number, instancesCount?: number): Mesh {
        if (!this._geometry || !this._geometry.getVertexBuffers() || (!this._unIndexed && !this._geometry.getIndexBuffer())) {
            return this;
        }

        const engine = this.getScene().getEngine();

        // Draw order

        if (this._unIndexed) {
            engine.drawArraysType(Material.LineListDrawMode, subMesh.verticesStart, subMesh.verticesCount, instancesCount);
        } else {
            engine.drawElementsType(Material.LineListDrawMode, subMesh.indexStart, subMesh.indexCount, instancesCount);
        }
        return this;
    }

    /**
     * Returns a new LineMesh object cloned from the current one.
     * @param name defines the cloned mesh name
     * @param newParent defines the new mesh parent
     * @param doNotCloneChildren if set to true, none of the mesh children are cloned (false by default)
     * @returns the new mesh
     */
    public override clone(name: string, newParent: Nullable<Node> | MeshCreationOptions = null, doNotCloneChildren?: boolean): LinesMesh {
        if (newParent && (newParent as Node)._addToSceneRootNodes === undefined) {
            const createOptions = newParent as MeshCreationOptions;
            createOptions.source = this;

            return new LinesMesh(name, this.getScene(), createOptions.parent, createOptions.source as Nullable<LinesMesh>, createOptions.doNotCloneChildren);
        }

        return new LinesMesh(name, this.getScene(), newParent as Nullable<Node>, this, doNotCloneChildren);
    }

    /**
     * Creates a new InstancedLinesMesh object from the mesh model.
     * @see https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances
     * @param name defines the name of the new instance
     * @returns a new InstancedLinesMesh
     */
    public override createInstance(name: string): InstancedLinesMesh {
        const instance = new InstancedLinesMesh(name, this);

        if (this.instancedBuffers) {
            instance.instancedBuffers = {};

            for (const key in this.instancedBuffers) {
                instance.instancedBuffers[key] = this.instancedBuffers[key];
            }
        }

        return instance;
    }

    /**
     * Serializes this ground mesh
     * @param serializationObject object to write serialization to
     */
    public override serialize(serializationObject: any): void {
        super.serialize(serializationObject);
        serializationObject.color = this.color.asArray();
        serializationObject.alpha = this.alpha;
    }

    /**
     * Parses a serialized ground mesh
     * @param parsedMesh the serialized mesh
     * @param scene the scene to create the ground mesh in
     * @returns the created ground mesh
     */
    public static override Parse(parsedMesh: any, scene: Scene): LinesMesh {
        const result = new LinesMesh(parsedMesh.name, scene);

        result.color = Color3.FromArray(parsedMesh.color);
        result.alpha = parsedMesh.alpha;

        return result;
    }
}

/**
 * Creates an instance based on a source LinesMesh
 */
export class InstancedLinesMesh extends InstancedMesh {
    /**
     * The intersection Threshold is the margin applied when intersection a segment of the LinesMesh with a Ray.
     * This margin is expressed in world space coordinates, so its value may vary.
     * Initialized with the intersectionThreshold value of the source LinesMesh
     */
    public intersectionThreshold: number;

    constructor(name: string, source: LinesMesh) {
        super(name, source);
        this.intersectionThreshold = source.intersectionThreshold;
    }

    /**
     * @returns the string "InstancedLinesMesh".
     */
    public override getClassName(): string {
        return "InstancedLinesMesh";
    }
}
