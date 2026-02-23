"use client"
import React, { Suspense, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { useGLTF, useTexture, OrbitControls, Center, Html, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

// Font loading resource for Suspense
let fontPromise: Promise<void> | null = null;
let fontLoaded = false;

function useFont(fontName: string, fontUrl: string) {
    if (fontLoaded) return;

    if (!fontPromise) {
        fontPromise = new Promise<void>((resolve) => {
            const font = new FontFace(fontName, `url(${fontUrl})`)
            font.load().then((loadedFont) => {
                document.fonts.add(loadedFont)
                fontLoaded = true
                resolve()
            }).catch((err) => {
                console.error(`Failed to load font ${fontName}:`, err)
                // Resolve anyway to avoid blocking forever on font failure
                fontLoaded = true
                resolve()
            })
        })
    }

    throw fontPromise;
}

type Jersey3DProps = {
    number: string | number
    text: string
    fontUrl?: string
    modelPath?: string
    texturePath?: string
    scale?: number
}

function JerseyModel({ number, text, fontUrl, modelPath = "/jersey/updated_shirt.glb", texturePath = "/jersey/void skyline 2.png" }: Jersey3DProps) {
    const { nodes, materials } = useGLTF(modelPath) as any
    const baseTexture = useTexture(texturePath)

    // Suspend until font is loaded
    useFont('Bebas Neue Custom', '/jersey/BebasNeue-Regular.ttf')

    // Global cache for generated canvases to avoid expensive 2D drawing on every mount
    // We store the HTMLCanvasElement, which can be reused as a source for textures in different WebGL contexts
    const textureCache = useMemo(() => {
        if (!(window as any).__jerseyTextureCache) {
            (window as any).__jerseyTextureCache = new Map<string, HTMLCanvasElement>();
        }
        return (window as any).__jerseyTextureCache as Map<string, HTMLCanvasElement>;
    }, []);

    // Create dynamic texture
    const dynamicTexture = useMemo(() => {
        const cacheKey = `${number}-${text}`;

        // Check cache first
        if (textureCache.has(cacheKey)) {
            const cachedCanvas = textureCache.get(cacheKey)!;
            const texture = new THREE.CanvasTexture(cachedCanvas);
            texture.flipY = false;
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        }

        const canvas = document.createElement('canvas')
        canvas.width = 2048
        canvas.height = 2048
        const ctx = canvas.getContext('2d')
        if (!ctx) return null

        // Draw base texture
        const img = baseTexture.image
        if (img && img instanceof HTMLImageElement) {
            canvas.width = img.width
            canvas.height = img.height
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        } else {
            // Fallback if image isn't loaded yet or valid
            return null
        }

        // Helper to draw text in a box with rotation
        const drawTextInBox = (
            text: string,
            x1: number,
            y1: number,
            x2: number,
            y2: number,
            rotation: number = 0,
            fontFamily: string = "Bebas Neue Custom",
            condenseX: number = 1.0 // Factor to horizontally squeeze text
        ) => {
            const width = Math.abs(x2 - x1)
            const height = Math.abs(y2 - y1)
            const cx = (x1 + x2) / 2
            const cy = (y1 + y2) / 2

            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(rotation)

            // Apply extra condensation if requested
            if (condenseX !== 1.0) {
                ctx.scale(condenseX, 1.0)
            }

            // Dynamic font scaling
            // Font size in pixels is usually larger than the visible character height (cap height).
            // For Arial, cap height is approx 0.7 of font size.
            // We want the character to fill the height, so we scale up.
            let fontSize = height / 0.75
            ctx.font = `bold ${fontSize}px '${fontFamily}'`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'

            // Measure and scale down if needed to fit width (taking condenseX into account for available width)
            // If we scaled the context by condenseX, the available width effectively increases relative to the text
            // So we check against width / condenseX
            let textWidth = ctx.measureText(text).width
            if (textWidth > (width / condenseX)) {
                fontSize = fontSize * ((width / condenseX) / textWidth)
                ctx.font = `bold ${fontSize}px '${fontFamily}'`
            }

            // Vertical centering adjustment
            // Since we are drawing with 'middle' baseline, but the font has descenders/ascenders space,
            // and numbers are usually centered on cap height, we might need a slight offset.
            // However, 'middle' is usually good enough for simple centering.
            // If it looks too low, we can adjust. For now, let's stick to the center.
            ctx.fillStyle = "white"
            ctx.fillText(text, 0, 0)
            // Outline Style
            // ctx.lineWidth = fontSize * 0.03 // Proportional line width
            // ctx.strokeStyle = 'white'
            // ctx.strokeText(text, 0, 0 + (height * 0.03))

            // // No fillText, as requested "transparent center"

            ctx.restore()
        }

        // Coordinate Scaling Factor (User provided coords for likely 1024x1024, but we use image size)
        // We'll assume user coords are for 1024x1024 and scale if image is different
        const scaleX = canvas.width / 2048
        const scaleY = canvas.height / 2048

        // 1. Back Number (Upside Down)
        // (72, 740) to (250, 890)
        drawTextInBox(
            String(number),
            120 * scaleX, 1450 * scaleY,
            563 * scaleX, 1700 * scaleY,
            Math.PI // 180 degrees
        )

        // 2. Front Number (Right Side Up)
        // (534, 286) to (620, 360)
        drawTextInBox(
            String(number),
            1014 * scaleX, 771 * scaleY,
            1209 * scaleX, 945 * scaleY,
            0
        )

        // 3. Back Name (Upside Down)
        // (45, 927) to (288, 967)
        // Use Arial Narrow AND extra condensation
        drawTextInBox(
            text.toUpperCase(),
            109 * scaleX, 1815 * scaleY,
            564 * scaleX, 1904 * scaleY,
            Math.PI,
            "Bebas Neue Custom",
            0.75 // Squeeze it to 75% width
        )

        // Cache the generated canvas
        textureCache.set(cacheKey, canvas);

        const texture = new THREE.CanvasTexture(canvas)
        texture.flipY = false
        texture.colorSpace = THREE.SRGBColorSpace
        return texture
    }, [baseTexture, number, text, textureCache])

    // Apply texture to material
    // We need to find the correct mesh. Usually it's the first child or named specifically.
    // For now, we'll apply it to all meshes found in the GLTF or specific one if known.
    // Inspecting the GLTF structure would be ideal, but we'll try to apply to the main mesh.

    // Clone the material to avoid sharing it across instances if we modify it
    const material = useMemo(() => {
        if (!materials || !Object.values(materials)[0]) return new THREE.MeshStandardMaterial();
        const mat = (Object.values(materials)[0] as THREE.MeshStandardMaterial).clone()

        // Fabric material properties - Fully matte
        mat.roughness = 1.0 // No shine
        mat.metalness = 0.0 // Non-metallic

        if (dynamicTexture) {
            mat.map = dynamicTexture
            mat.needsUpdate = true
        }
        return mat
    }, [materials, dynamicTexture])


    return (
        <group dispose={null}>
            {/* Render all meshes in the GLTF, applying the dynamic material */}
            {Object.entries(nodes).map(([name, node]: [string, any]) => {
                if (node.isMesh) {
                    return (
                        <mesh
                            key={name}
                            geometry={node.geometry}
                            material={material}
                        />
                    )
                }
                return null
            })}
        </group>
    )
}

function Loader() {
    return <Html center></Html>
}

export default function Jersey3D(props: Jersey3DProps & { showBack?: boolean }) {
    return (
        <div className="w-full h-full">
            <Canvas camera={{ position: [0, 0, 1.5], fov: 45 }}>
                {/* Even, Bright Scene Lighting */}
                <ambientLight intensity={3.0} /> {/* High ambient for evenness */}
                <directionalLight position={[5, 5, 5]} intensity={0.5} /> {/* Soft directional for slight depth */}
                <pointLight position={[-10, -10, -10]} intensity={0.5} />

                <Suspense fallback={<Loader />}>
                    <Center>
                        <group scale={props.scale ?? 1}>
                            <JerseyModel {...props} />
                        </group>
                    </Center>
                    <ContactShadows
                        position={[0, -0.8, 0]}
                        opacity={0.7}
                        scale={10}
                        blur={2}
                        far={4}
                    />
                </Suspense>

                {/* Animated Controls */}
                <AnimatedControls showBack={props.showBack ?? false} />
            </Canvas>
        </div>
    )
}

// Custom component to handle the full-spin animation
function AnimatedControls({ showBack }: { showBack: boolean }) {
    const { gl, camera } = useThree();
    const controlsRef = React.useRef<any>(null);
    const animationStartTime = React.useRef<number>(0);
    const animationDuration = 600; // 0.6 seconds to match drawer transition
    const isAnimating = React.useRef<boolean>(false);
    const animationFrameId = React.useRef<number | null>(null);
    const previousShowBack = React.useRef<boolean>(showBack);
    const startAzimuth = React.useRef<number>(0);

    React.useEffect(() => {
        if (showBack !== previousShowBack.current) {
            if (showBack) {
                // Start the spin animation to back
                isAnimating.current = true;
                animationStartTime.current = Date.now();

                if (controlsRef.current) {
                    startAzimuth.current = controlsRef.current.getAzimuthalAngle();
                }

                const animate = () => {
                    if (!controlsRef.current || !isAnimating.current) return;

                    const elapsed = Date.now() - animationStartTime.current;
                    const progress = Math.min(elapsed / animationDuration, 1);

                    // Ease-out cubic for smooth deceleration
                    const eased = 1 - Math.pow(1 - progress, 3);

                    // Calculate rotation: do a full 360° spin and end at PI (back)
                    // Total rotation = 2*PI (360°) + (PI - startAzimuth)
                    const targetRotation = 2 * Math.PI + (Math.PI - startAzimuth.current);
                    const currentRotation = startAzimuth.current + (targetRotation * eased);

                    controlsRef.current.setAzimuthalAngle(currentRotation);

                    if (progress < 1) {
                        animationFrameId.current = requestAnimationFrame(animate);
                    } else {
                        // Animation complete, settle at back
                        controlsRef.current.setAzimuthalAngle(Math.PI);
                        isAnimating.current = false;
                    }
                };

                animate();
            } else {
                // Spin back to front
                if (animationFrameId.current) {
                    cancelAnimationFrame(animationFrameId.current);
                }

                isAnimating.current = true;
                animationStartTime.current = Date.now();

                if (controlsRef.current) {
                    startAzimuth.current = controlsRef.current.getAzimuthalAngle();
                }

                const animateBack = () => {
                    if (!controlsRef.current || !isAnimating.current) return;

                    const elapsed = Date.now() - animationStartTime.current;
                    const progress = Math.min(elapsed / animationDuration, 1);

                    // Ease-out cubic for smooth deceleration
                    const eased = 1 - Math.pow(1 - progress, 3);

                    // Calculate rotation: spin back to 0 (front)
                    const targetRotation = -Math.PI; // Spin backwards
                    const currentRotation = startAzimuth.current + (targetRotation * eased);

                    controlsRef.current.setAzimuthalAngle(currentRotation);

                    if (progress < 1) {
                        animationFrameId.current = requestAnimationFrame(animateBack);
                    } else {
                        // Animation complete, settle at front
                        controlsRef.current.setAzimuthalAngle(0);
                        isAnimating.current = false;
                    }
                };

                animateBack();
            }
            previousShowBack.current = showBack;
        }

        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
        };
    }, [showBack]);

    // Safeguard: if no domElement, don't render controls
    if (!gl.domElement) return null;

    return (
        <OrbitControls
            ref={controlsRef}
            domElement={gl.domElement}
            args={[camera, gl.domElement]}
            autoRotate={!showBack && !isAnimating.current}
            autoRotateSpeed={4}
            enableZoom={false}
            minPolarAngle={Math.PI / 2}
            maxPolarAngle={Math.PI / 2}
            enableRotate={!showBack && !isAnimating.current}
        />
    );
}

useGLTF.preload("/jersey/shirt_baked.glb")
