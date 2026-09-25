import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { useEditorStore } from '../store/editorStore'
import { applyObjectState, disposeObject, extractEditableObjects, isHidden, parseGLB } from '../three/gltf'
import { gizmoState, meshRegistry, thumbnailCapture } from '../three/registry'
import type { RoomObject } from '../types'

/** ドラッグ(視点操作)とクリックを区別するしきい値(px) */
const CLICK_TOLERANCE = 4

export function Viewer() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="relative h-full w-full bg-neutral-900">
      <Canvas
        shadows={false}
        dpr={[1, 2]}
        camera={{ position: [4, 4, 6], fov: 50, near: 0.01, far: 1000 }}
        onPointerMissed={() => {
          if (!gizmoState.active) useEditorStore.getState().select(null)
        }}
      >
        <color attach="background" args={['#1f2328']} />
        <hemisphereLight args={['#ffffff', '#444444', 1.6]} />
        <directionalLight position={[5, 10, 7]} intensity={1.8} />
        <Grid
          infiniteGrid
          cellSize={0.5}
          sectionSize={2.5}
          cellColor="#3a3f46"
          sectionColor="#555c66"
          fadeDistance={40}
          position={[0, -0.001, 0]}
        />
        <RoomModel
          onLoaded={() => setStatus('ready')}
          onError={(e) => {
            setStatus('error')
            setError(e)
          }}
          onLoading={() => setStatus('loading')}
        />
        <SelectionControls />
        <OrbitControls makeDefault enableDamping dampingFactor={0.15} />
        <ThumbnailCapturer />
      </Canvas>

      {status === 'loading' && (
        <Overlay>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-500 border-t-white" />
          <p>GLBを読み込み中…</p>
        </Overlay>
      )}
      {status === 'error' && (
        <Overlay>
          <p className="font-semibold text-red-300">GLBの読み込みに失敗しました</p>
          <p className="max-w-md text-sm text-neutral-400">{error}</p>
        </Overlay>
      )}
      <HelpHint />
    </div>
  )
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-200">
      {children}
    </div>
  )
}

function HelpHint() {
  return (
    <>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/50 px-3 py-2 text-xs leading-relaxed text-neutral-300 pointer-coarse:hidden">
        クリック: 選択 / 左ドラッグ: 回転 / 右ドラッグ: 平行移動 / ホイール: ズーム
        <br />
        W: 移動 / E: 回転 / Delete: 削除 / Esc: 選択解除 / Ctrl+Z・Ctrl+Shift+Z: 元に戻す・やり直し
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 hidden rounded bg-black/50 px-2 py-1 text-[11px] text-neutral-300 pointer-coarse:block">
        タップ: 選択 / 1本指: 回転 / 2本指: 移動・ズーム
      </div>
    </>
  )
}

/** タッチ操作の端末ではギズモを大きくしてつかみやすくする */
const isCoarsePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

interface RoomModelProps {
  onLoading: () => void
  onLoaded: () => void
  onError: (message: string) => void
}

function RoomModel({ onLoading, onLoaded, onError }: RoomModelProps) {
  const glbData = useEditorStore((s) => s.room?.glbData)
  const objects = useEditorStore((s) => s.objects)
  const [scene, setScene] = useState<THREE.Group | null>(null)
  const applied = useRef<Record<string, RoomObject>>({})
  const callbacks = useRef({ onLoading, onLoaded, onError })
  callbacks.current = { onLoading, onLoaded, onError }

  useEffect(() => {
    if (!glbData) return
    let cancelled = false
    let loaded: THREE.Group | null = null
    callbacks.current.onLoading()

    parseGLB(glbData)
      .then((group) => {
        if (cancelled) return disposeObject(group)
        loaded = group
        const { objects: base, nodes } = extractEditableObjects(group)
        meshRegistry.clear()
        nodes.forEach((mesh, id) => meshRegistry.set(id, mesh))
        applied.current = {}
        useEditorStore.getState().initObjects(base)
        setScene(group)
        callbacks.current.onLoaded()
      })
      .catch((e: unknown) => {
        if (!cancelled) callbacks.current.onError(e instanceof Error ? e.message : String(e))
      })

    return () => {
      cancelled = true
      meshRegistry.clear()
      setScene(null)
      if (loaded) disposeObject(loaded)
    }
  }, [glbData])

  // ストアの編集状態を、変更のあったメッシュにだけ反映する
  useLayoutEffect(() => {
    if (!scene) return
    for (const [id, obj] of Object.entries(objects)) {
      if (applied.current[id] === obj) continue
      const mesh = meshRegistry.get(id)
      if (mesh) applyObjectState(mesh, obj)
    }
    applied.current = objects
  }, [objects, scene])

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    // 削除済み(非表示)のメッシュは無視して、奥にあるメッシュへイベントを流す
    if (isHidden(e.object)) return
    e.stopPropagation()
    if (e.delta > CLICK_TOLERANCE || gizmoState.active) return
    const id = e.object.userData.roomObjectId as string | undefined
    if (id) useEditorStore.getState().select(id)
  }

  const setCursor = (cursor: string) => (e: ThreeEvent<PointerEvent>) => {
    if (isHidden(e.object)) return
    e.stopPropagation()
    document.body.style.cursor = cursor
  }

  if (!scene) return null
  return (
    <>
      <primitive
        object={scene}
        onClick={handleClick}
        onPointerOver={setCursor('pointer')}
        onPointerOut={setCursor('auto')}
      />
      <FrameCamera target={scene} />
    </>
  )
}

/** 読み込んだ部屋全体が画面に収まるようにカメラを配置する */
function FrameCamera({ target }: { target: THREE.Object3D }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null

  useEffect(() => {
    if (!controls) return
    const box = new THREE.Box3().setFromObject(target)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1
    const persp = camera as THREE.PerspectiveCamera
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(persp.fov / 2))
    const dir = new THREE.Vector3(0.6, 0.7, 1).normalize()
    camera.position.copy(center).addScaledVector(dir, distance * 0.9)
    camera.near = Math.max(radius / 1000, 0.001)
    camera.far = radius * 100
    camera.updateProjectionMatrix()
    controls.target.copy(center)
    controls.update()
  }, [target, camera, controls])

  return null
}

/** 選択中オブジェクトのハイライト(バウンディングボックス)と移動・回転ギズモ */
function SelectionControls() {
  const selectedId = useEditorStore((s) => s.selectedId)
  const mode = useEditorStore((s) => s.transformMode)
  // メッシュ読み込み完了で再描画されるよう objects も購読する
  const selected = useEditorStore((s) => (s.selectedId ? s.objects[s.selectedId] : undefined))
  const mesh = selectedId && selected && !selected.deleted ? meshRegistry.get(selectedId) : undefined

  const helper = useMemo(() => {
    const h = new THREE.BoxHelper(new THREE.Object3D(), 0xffc107)
    h.userData.hideInThumbnail = true
    return h
  }, [])
  useEffect(() => () => helper.dispose(), [helper])

  useFrame(() => {
    if (!mesh) return
    helper.setFromObject(mesh)
  })

  if (!mesh) return null

  const snapshot = () => {
    const state = useEditorStore.getState()
    state.previewObject(selectedId!, {
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    })
  }

  return (
    <>
      <primitive object={helper} />
      <TransformControls
        object={mesh}
        mode={mode}
        size={isCoarsePointer ? 1.4 : 0.9}
        onMouseDown={() => {
          gizmoState.active = true
        }}
        onObjectChange={snapshot}
        onMouseUp={() => {
          useEditorStore.getState().commitPreview()
          // mouseup直後に発火するclickで選択が変わらないよう、少し遅らせて解除する
          setTimeout(() => {
            gizmoState.active = false
          }, 0)
        }}
      />
    </>
  )
}

/** 保存時に一覧用のサムネイルを撮影する関数を登録する */
function ThumbnailCapturer() {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    thumbnailCapture.current = () => {
      // ギズモやハイライトを隠して1フレーム描画し、その場で画像化する
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (o.visible && (o.userData.hideInThumbnail || o.type.startsWith('TransformControls'))) {
          o.visible = false
          hidden.push(o)
        }
      })
      gl.render(scene, camera)
      const src = gl.domElement
      hidden.forEach((o) => (o.visible = true))

      const width = 320
      const height = Math.round((width * src.height) / src.width) || 200
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(src, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', 0.75)
    }
    return () => {
      thumbnailCapture.current = null
    }
  }, [gl, scene, camera])

  return null
}
