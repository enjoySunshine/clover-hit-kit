import { Matrix } from '../../../maths/matrix/Matrix';
import { Point } from '../../../maths/point/Point';
import type { PointData } from '../../../maths/point/PointData';
import type { Rectangle } from '../../../maths/shapes/Rectangle';
import { Bounds } from '../../../container/bounds/Bounds';
import type {
    FillInstruction,
    GraphicsInstructions,
    StrokeInstruction,
} from '../GraphicsContext';
import type { ShapePrimitiveWithHoles } from '../path/ShapePath';
import { getMaxMiterRatio } from './getMaxMiterRatio';

/**
 * A single hit testable shape collected from a graphics instruction.
 *
 * The entry keeps a reference to the original shape (it never mutates or
 * clones it) together with the transform that was baked into its path. Its
 * world space bounding box is computed once while the index is built and is
 * used to register the shape with the grid cells it overlaps.
 * @internal
 */
export interface HitTestEntry
{
    /** The original shape primitive. */
    shape: ShapePrimitiveWithHoles['shape'];
    /** The transform applied to the shape, or `undefined` for the identity matrix. */
    transform?: Matrix;
    /** `true` when the owning instruction is a stroke, `false` when it is a fill. */
    isStroke: boolean;
    /** Stroke width - only meaningful when {@link HitTestEntry.isStroke} is `true`. */
    strokeWidth: number;
    /** Stroke alignment - only meaningful when {@link HitTestEntry.isStroke} is `true`. */
    strokeAlignment: number;
    /** Holes cut out of this entry's shape, either via `cut()` or even odd paths. */
    holes?: ShapePrimitiveWithHoles[];
    /** Minimum x of the entry's world space bounding box. */
    minX: number;
    /** Minimum y of the entry's world space bounding box. */
    minY: number;
    /** Maximum x of the entry's world space bounding box. */
    maxX: number;
    /** Maximum y of the entry's world space bounding box. */
    maxY: number;
}

/**
 * The size (in local pixels) of a single cell in the hit test grid.
 *
 * Shapes are typically small, so a 32px cell keeps the number of entries per
 * cell close to one while the number of cells stays small even for very large
 * scenes (e.g. thousands of small rectangles).
 */
const HIT_TEST_CELL_SIZE = 32;

/**
 * Shift used when packing a cell's column/row into a single numeric map key.
 * Coordinates are offset so that negative grid positions remain non-negative.
 */
const HIT_TEST_KEY_BIAS = 0x200000;
const HIT_TEST_KEY_RANGE = 0x400000;

const tmpPoint = new Point();
const tmpBoundsRect: Rectangle = {} as Rectangle;
const tmpBounds = new Bounds();

/**
 * A uniform spatial hash grid that accelerates
 * {@link GraphicsContext.containsPoint} lookups.
 *
 * Without an index every query has to walk every draw instruction and every
 * shape inside it, which is `O(n)` per query. This index registers every fill
 * and stroke shape with the grid cells its bounding box overlaps. A query
 * only inspects the single cell the point falls into and walks its entries in
 * reverse draw order so the top most shape wins, making the average query
 * effectively `O(1)`.
 *
 * The index is built lazily on the first query and is cached - any mutation of
 * the owning context marks it dirty and the next query rebuilds it.
 * @internal
 */
export class HitTestSpatialIndex
{
    private readonly _cells = new Map<number, HitTestEntry[]>();

    /**
     * Rebuilds the grid from the given draw instructions.
     * @param instructions - The fill / stroke / texture instructions of a graphics context.
     */
    public update(instructions: GraphicsInstructions[]): void
    {
        this._cells.clear();

        for (let k = 0; k < instructions.length; k++)
        {
            const instruction = instructions[k];
            const action = instruction.action;

            if (action !== 'fill' && action !== 'stroke') continue;

            const data = instruction.data as FillInstruction['data'] | StrokeInstruction['data'];
            const path = data.path;

            if (!path) continue;

            const isStroke = action === 'stroke';
            const style = data.style as StrokeInstruction['data']['style'];
            const shapes = path.shapePath.shapePrimitives;
            const cutHoles = data.hole?.shapePath?.shapePrimitives;

            // Mirrors the padding used when calculating a stroke's bounds so
            // that stroked points can never fall outside of their grid cells.
            let outerPadding = 0;

            if (isStroke)
            {
                outerPadding = style.width * (1 - style.alignment);

                if (style.join === 'miter')
                {
                    outerPadding *= getMaxMiterRatio(path, style.miterLimit);
                }
            }

            for (let i = 0; i < shapes.length; i++)
            {
                const shapePrimitive = shapes[i];
                const shape = shapePrimitive.shape;

                if (!shape) continue;

                const transform = shapePrimitive.transform;
                const localBounds = shape.getBounds(tmpBoundsRect);

                tmpBounds.clear();
                tmpBounds.addFrame(
                    localBounds.x - outerPadding,
                    localBounds.y - outerPadding,
                    localBounds.x + localBounds.width + outerPadding,
                    localBounds.y + localBounds.height + outerPadding,
                    transform
                );

                // Holes created with cut() belong to the whole instruction while
                // holes created via even odd paths live on the shape itself.
                const holes = cutHoles || shapePrimitive.holes;

                const entry: HitTestEntry = {
                    shape,
                    transform,
                    isStroke,
                    strokeWidth: isStroke ? style.width : 0,
                    strokeAlignment: isStroke ? style.alignment : 0.5,
                    holes,
                    minX: tmpBounds.minX,
                    minY: tmpBounds.minY,
                    maxX: tmpBounds.maxX,
                    maxY: tmpBounds.maxY,
                };

                this._addEntry(entry);
            }
        }
    }

    /**
     * Registers an entry with every grid cell its bounding box overlaps.
     * Entries are appended in draw order, which is relied upon during queries.
     */
    private _addEntry(entry: HitTestEntry): void
    {
        const startColumn = Math.floor(entry.minX / HIT_TEST_CELL_SIZE);
        const endColumn = Math.floor(entry.maxX / HIT_TEST_CELL_SIZE);
        const startRow = Math.floor(entry.minY / HIT_TEST_CELL_SIZE);
        const endRow = Math.floor(entry.maxY / HIT_TEST_CELL_SIZE);

        for (let row = startRow; row <= endRow; row++)
        {
            for (let column = startColumn; column <= endColumn; column++)
            {
                const key = ((row + HIT_TEST_KEY_BIAS) * HIT_TEST_KEY_RANGE) + column + HIT_TEST_KEY_BIAS;
                let cell = this._cells.get(key);

                if (!cell)
                {
                    cell = [];
                    this._cells.set(key, cell);
                }

                cell.push(entry);
            }
        }
    }

    /**
     * Checks whether a point is contained within any of the indexed shapes.
     *
     * Entries are tested in reverse draw order so that shapes drawn later take
     * precedence, matching the painters model used when rendering.
     * @param point - The point to test in the context's local space.
     * @returns `true` when the point hits a fill or stroke that is not cut out.
     */
    public containsPoint(point: PointData): boolean
    {
        const column = Math.floor(point.x / HIT_TEST_CELL_SIZE);
        const row = Math.floor(point.y / HIT_TEST_CELL_SIZE);
        const key = ((row + HIT_TEST_KEY_BIAS) * HIT_TEST_KEY_RANGE) + column + HIT_TEST_KEY_BIAS;
        const cell = this._cells.get(key);

        if (!cell) return false;

        for (let i = cell.length - 1; i >= 0; i--)
        {
            const entry = cell[i];

            // The point lives in one of the entry's cells but the entry's box
            // may span several cells, so reject points outside of its box.
            if (point.x < entry.minX || point.x > entry.maxX
                || point.y < entry.minY || point.y > entry.maxY)
            {
                continue;
            }

            const transformedPoint = entry.transform
                ? entry.transform.applyInverse(point, tmpPoint)
                : point;

            let hasHit = entry.isStroke
                ? entry.shape.strokeContains(
                    transformedPoint.x,
                    transformedPoint.y,
                    entry.strokeWidth,
                    entry.strokeAlignment
                )
                : entry.shape.contains(transformedPoint.x, transformedPoint.y);

            if (hasHit && entry.holes)
            {
                for (let j = 0; j < entry.holes.length; j++)
                {
                    const hole = entry.holes[j];

                    if (hole.shape && hole.shape.contains(transformedPoint.x, transformedPoint.y))
                    {
                        hasHit = false;
                        break;
                    }
                }
            }

            if (hasHit) return true;
        }

        return false;
    }

    /** Releases all of the memory held by the index. */
    public clear(): void
    {
        this._cells.clear();
    }
}
