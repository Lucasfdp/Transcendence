import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type GameCard = {
	id: string;
	name: string;
	description: string;
	available: boolean;
};

interface GameSphereSelectorProps {
	games: GameCard[];
	onSelectGame: (gameId: string) => void;
	onSelectLockedGame: (game: GameCard) => void;
}

type Marker = {
	game: GameCard;
	group: THREE.Group;
	body: THREE.Mesh;
	label: HTMLDivElement;
};

const CARDINAL_ORDER = [
	"kame-knock",
	"temple-curling",
	"bamboo-bash",
	"bell-clash",
];

const CARDINAL_POSITIONS = [
	new THREE.Vector3(7.4, 0, 0),
	new THREE.Vector3(0, 0, 7.4),
	new THREE.Vector3(-7.4, 0, 0),
	new THREE.Vector3(0, 0, -7.4),
];

const ACCENT_COLORS = [0xffbc6b, 0x78c7ff, 0x95f0a9, 0xff8b7f];

export function GameSphereSelector({
	games,
	onSelectGame,
	onSelectLockedGame,
}: GameSphereSelectorProps): JSX.Element {
	const mountRef = useRef<HTMLDivElement | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const selectGameRef = useRef(onSelectGame);
	const selectLockedGameRef = useRef(onSelectLockedGame);

	useEffect(() => {
		selectGameRef.current = onSelectGame;
		selectLockedGameRef.current = onSelectLockedGame;
	}, [onSelectGame, onSelectLockedGame]);

	const orderedGames = useMemo(() => {
		const mapped = new Map(games.map((game) => [game.id, game]));
		return CARDINAL_ORDER.map((id) => mapped.get(id)).filter(
			(game): game is GameCard => Boolean(game),
		);
	}, [games]);

	useEffect(() => {
		const mount = mountRef.current;
		const overlay = overlayRef.current;
		if (!mount || !overlay || orderedGames.length === 0) return;

		const renderer = new THREE.WebGLRenderer({
			alpha: true,
			antialias: true,
		});
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
		renderer.domElement.className = "hub-sphere__canvas";
		mount.appendChild(renderer.domElement);

		const scene = new THREE.Scene();
		scene.fog = new THREE.FogExp2(0x070b13, 0.035);

		const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
		camera.position.set(0, 0.8, 19);

		const root = new THREE.Group();
		root.position.y = 1.1;
		root.rotation.x = -0.04;
		root.rotation.y = 0.22;
		scene.add(root);

		const ambient = new THREE.HemisphereLight(0xf6d9a9, 0x0a1224, 1.4);
		scene.add(ambient);

		const keyLight = new THREE.DirectionalLight(0xffe4b5, 2.1);
		keyLight.position.set(10, 12, 8);
		scene.add(keyLight);

		const rimLight = new THREE.DirectionalLight(0x7db9ff, 1.1);
		rimLight.position.set(-8, 4, -10);
		scene.add(rimLight);

		const sphere = new THREE.Mesh(
			new THREE.SphereGeometry(4.35, 64, 64),
			new THREE.MeshPhysicalMaterial({
				color: 0xc6844d,
				metalness: 0.2,
				roughness: 0.38,
				clearcoat: 0.8,
				clearcoatRoughness: 0.32,
				iridescence: 0.25,
			}),
		);
		root.add(sphere);

		const wireframe = new THREE.Mesh(
			new THREE.SphereGeometry(4.55, 24, 24),
			new THREE.MeshBasicMaterial({
				color: 0xf6d9a9,
				wireframe: true,
				transparent: true,
				opacity: 0.16,
			}),
		);
		root.add(wireframe);

		const halo = new THREE.Mesh(
			new THREE.TorusGeometry(6.4, 0.12, 20, 100),
			new THREE.MeshBasicMaterial({
				color: 0xefaa63,
				transparent: true,
				opacity: 0.3,
			}),
		);
		halo.rotation.x = Math.PI / 2.08;
		root.add(halo);

		const floor = new THREE.Mesh(
			new THREE.CircleGeometry(16, 64),
			new THREE.ShadowMaterial({ opacity: 0.18 }),
		);
		floor.rotation.x = -Math.PI / 2;
		floor.position.y = -7.5;
		scene.add(floor);

		const pedestals: Marker[] = [];
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		const interactive: THREE.Object3D[] = [];
		const labelWorldPos = new THREE.Vector3();
		let hoveredId: string | null = null;
		let rafId = 0;
		let currentRotY = 0.22;
		let targetTiltX = -0.04;
		let currentTiltX = -0.04;
		let spinVelocityY = 0;
		let targetSpinVelocityY = 0;

		orderedGames.forEach((game, index) => {
			const group = new THREE.Group();
			group.position.copy(
				CARDINAL_POSITIONS[index % CARDINAL_POSITIONS.length].clone(),
			);
			group.lookAt(0, 0, 0);

			const accent = ACCENT_COLORS[index % ACCENT_COLORS.length];
			const body = new THREE.Mesh(
				new THREE.BoxGeometry(1.62, 1.62, 1.62),
				new THREE.MeshStandardMaterial({
					color: game.available ? accent : 0x59606d,
					emissive: game.available ? accent : 0x1d1d22,
					emissiveIntensity: game.available ? 0.2 : 0.08,
					metalness: 0.35,
					roughness: 0.4,
				}),
			);
			body.userData.game = game;
			body.userData.interactive = true;
			interactive.push(body);
			group.add(body);

			const frame = new THREE.Mesh(
				new THREE.BoxGeometry(2.45, 0.2, 2.45),
				new THREE.MeshStandardMaterial({
					color: 0x2c170f,
					metalness: 0.12,
					roughness: 0.82,
				}),
			);
			frame.position.y = -1.62;
			group.add(frame);

			const cap = new THREE.Mesh(
				new THREE.TorusGeometry(0.88, 0.14, 18, 42),
				new THREE.MeshStandardMaterial({
					color: 0xf5d8a7,
					metalness: 0.08,
					roughness: 0.52,
				}),
			);
			cap.rotation.x = Math.PI / 2;
			cap.position.y = 1.48;
			group.add(cap);

			root.add(group);

			const label = document.createElement("div");
			label.className = `hub-sphere__label${
				game.available ? "" : " hub-sphere__label--locked"
			}`;
			label.innerHTML = `<strong>${game.name}</strong><span>${
				game.available ? "Launch arena" : "Coming soon"
			}</span>`;
			overlay.appendChild(label);

			pedestals.push({ game, group, body, label });
		});

		const resize = () => {
			const width = mount.clientWidth;
			const height = mount.clientHeight;
			renderer.setSize(width, height, false);
			camera.aspect = width / Math.max(height, 1);
			camera.updateProjectionMatrix();
		};

		const updateLabels = () => {
			const width = mount.clientWidth;
			const height = mount.clientHeight;
			pedestals.forEach(({ game, group, label }) => {
				group.getWorldPosition(labelWorldPos);
				labelWorldPos.y += 2.3;
				labelWorldPos.project(camera);

				const visible = labelWorldPos.z < 1;
				const x = (labelWorldPos.x * 0.5 + 0.5) * width;
				const y = (labelWorldPos.y * -0.5 + 0.5) * height;
				const depthScale = THREE.MathUtils.clamp(
					1 - labelWorldPos.z * 0.18,
					0.72,
					1.12,
				);

				label.style.opacity = visible ? (hoveredId === game.id ? "1" : "0.78") : "0";
				label.style.transform = `translate(-50%, -50%) translate(${x.toFixed(
					1,
				)}px, ${y.toFixed(1)}px) scale(${depthScale.toFixed(3)})`;
			});
		};

		const setHovered = (nextId: string | null) => {
			if (hoveredId === nextId) return;
			hoveredId = nextId;
			mount.style.cursor = nextId ? "pointer" : "default";
			pedestals.forEach(({ game, group, label }) => {
				const active = game.id === hoveredId;
				group.scale.setScalar(active ? 1.12 : 1);
				label.classList.toggle("is-active", active);
			});
		};

		const handlePointerMove = (event: PointerEvent) => {
			const centeredX = THREE.MathUtils.clamp(
				(event.clientX / window.innerWidth) * 2 - 1,
				-1,
				1,
			);
			const centeredY = THREE.MathUtils.clamp(
				(event.clientY / window.innerHeight) * 2 - 1,
				-1,
				1,
			);

			const rect = mount.getBoundingClientRect();
			const localX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			const localY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);

			targetSpinVelocityY = THREE.MathUtils.clamp(-centeredX * 0.028, -0.028, 0.028);
			targetTiltX = THREE.MathUtils.clamp(-centeredY * 0.22 - 0.03, -0.22, 0.22);

			pointer.x = THREE.MathUtils.clamp(localX, -1, 1);
			pointer.y = THREE.MathUtils.clamp(localY, -1, 1);
			raycaster.setFromCamera(pointer, camera);
			const hit = raycaster.intersectObjects(interactive, false)[0];
			const nextGame = hit?.object.userData.game as GameCard | undefined;
			setHovered(nextGame?.id ?? null);
		};

		const handlePointerLeave = () => {
			setHovered(null);
			targetSpinVelocityY = 0;
			targetTiltX = -0.04;
		};

		const handleClick = () => {
			if (!hoveredId) return;
			const game = orderedGames.find((entry) => entry.id === hoveredId);
			if (!game) return;
			if (game.available) selectGameRef.current(game.id);
			else selectLockedGameRef.current(game);
		};

		const animate = () => {
			rafId = window.requestAnimationFrame(animate);
			spinVelocityY = THREE.MathUtils.lerp(
				spinVelocityY,
				targetSpinVelocityY,
				0.08,
			);
			currentRotY += spinVelocityY;
			currentTiltX = THREE.MathUtils.lerp(currentTiltX, targetTiltX, 0.06);
			root.rotation.y = currentRotY;
			root.rotation.x = currentTiltX;
			sphere.rotation.y += 0.0018;
			wireframe.rotation.y -= 0.0012;
			halo.rotation.z += 0.0011;
			pedestals.forEach(({ game, group, body }, index) => {
				const lift = game.id === hoveredId ? 0.48 : 0;
				body.rotation.x += 0.006;
				body.rotation.y += 0.01;
				group.rotation.y = Math.sin(performance.now() * 0.00045 + index) * 0.18;
				group.position.y = lift + Math.sin(performance.now() * 0.0009 + index) * 0.12;
			});
			updateLabels();
			renderer.render(scene, camera);
		};

		resize();
		animate();

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(mount);
		window.addEventListener("pointermove", handlePointerMove);
		mount.addEventListener("pointerleave", handlePointerLeave);
		mount.addEventListener("click", handleClick);

		return () => {
			window.cancelAnimationFrame(rafId);
			resizeObserver.disconnect();
			window.removeEventListener("pointermove", handlePointerMove);
			mount.removeEventListener("pointerleave", handlePointerLeave);
			mount.removeEventListener("click", handleClick);
			overlay.replaceChildren();
			renderer.dispose();
			scene.traverse((object) => {
				const mesh = object as THREE.Mesh;
				if (mesh.geometry) mesh.geometry.dispose();
				const material = mesh.material;
				if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
				else material?.dispose?.();
			});
			mount.replaceChildren();
		};
	}, [orderedGames]);

	return (
		<div className="hub-sphere">
			<div className="hub-sphere__copy">
				<p className="hub-sphere__eyebrow">Orbital Selector</p>
				<h2>Steer the globe and strike a shrine.</h2>
				<p>
					The sphere follows the cursor. Each cardinal altar is a 3D entry
					point to one of the four current arenas.
				</p>
			</div>
			<div className="hub-sphere__viewport">
				<div ref={mountRef} className="hub-sphere__mount" aria-hidden="true" />
				<div ref={overlayRef} className="hub-sphere__overlay" />
			</div>
			<div className="hub-sphere__fallback" aria-label="Game list">
				{orderedGames.map((game) => (
					<button
						key={game.id}
						type="button"
						className={`hub-sphere__fallback-button${
							game.available ? "" : " is-locked"
						}`}
						onClick={() =>
							game.available
								? onSelectGame(game.id)
								: onSelectLockedGame(game)
						}
					>
						<strong>{game.name}</strong>
						<span>{game.available ? game.description : "Coming soon"}</span>
					</button>
				))}
			</div>
		</div>
	);
}
