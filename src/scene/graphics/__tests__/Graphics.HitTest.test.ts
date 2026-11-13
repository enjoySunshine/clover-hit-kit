import { Graphics } from '../shared/Graphics';
import { Point } from '~/maths';

describe('Graphics containsPoint spatial index', () =>
{
    it('hits and misses the correct rectangles in a 4000 rectangle grid', () =>
    {
        const graphics = new Graphics();

        for (let i = 0; i < 4000; i++)
        {
            const column = i % 80;
            const row = Math.floor(i / 80);

            graphics.rect(column * 20, row * 20, 10, 10);
        }

        graphics.fill(0xffffff);

        expect(graphics.containsPoint(new Point(5, 5))).toBe(true);
        expect(graphics.containsPoint(new Point(15, 15))).toBe(false);
        expect(graphics.containsPoint(new Point(85, 65))).toBe(true);
        expect(graphics.containsPoint(new Point(1585, 985))).toBe(true);
        expect(graphics.containsPoint(new Point(15, 5))).toBe(false);
    });

    it('keeps 200 gap queries under 20ms, all missing', () =>
    {
        const graphics = new Graphics();

        for (let i = 0; i < 4000; i++)
        {
            const column = i % 80;
            const row = Math.floor(i / 80);

            graphics.rect(column * 20, row * 20, 10, 10);
        }

        graphics.fill(0xffffff);

        // build the spatial index before timing the queries
        graphics.containsPoint(new Point(0, 0));

        const start = performance.now();

        for (let i = 0; i < 200; i++)
        {
            const x = 15 + ((i % 50) * 20);
            const y = 15;

            expect(graphics.containsPoint(new Point(x, y))).toBe(false);
        }

        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(20);
    });

    it('keeps 200 last-block centre queries under 20ms, all hitting', () =>
    {
        const graphics = new Graphics();

        for (let i = 0; i < 4000; i++)
        {
            const column = i % 80;
            const row = Math.floor(i / 80);

            graphics.rect(column * 20, row * 20, 10, 10);
        }

        graphics.fill(0xffffff);

        graphics.containsPoint(new Point(0, 0));

        const start = performance.now();

        for (let i = 0; i < 200; i++)
        {
            expect(graphics.containsPoint(new Point(1585, 985))).toBe(true);
        }

        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(20);
    });

    it('keeps 200 first-block centre queries under 20ms, all hitting', () =>
    {
        const graphics = new Graphics();

        for (let i = 0; i < 4000; i++)
        {
            const column = i % 80;
            const row = Math.floor(i / 80);

            graphics.rect(column * 20, row * 20, 10, 10);
        }

        graphics.fill(0xffffff);

        graphics.containsPoint(new Point(0, 0));

        const start = performance.now();

        for (let i = 0; i < 200; i++)
        {
            expect(graphics.containsPoint(new Point(5, 5))).toBe(true);
        }

        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(20);
    });

    it('includes shapes added after the index was built', () =>
    {
        const graphics = new Graphics();

        for (let i = 0; i < 4000; i++)
        {
            const column = i % 80;
            const row = Math.floor(i / 80);

            graphics.rect(column * 20, row * 20, 10, 10);
        }

        graphics.fill(0xffffff);

        // force the index to build before the extra rectangle exists
        expect(graphics.containsPoint(new Point(5, 5))).toBe(true);

        graphics.rect(3000, 0, 10, 10).fill(0xffffff);

        expect(graphics.containsPoint(new Point(3005, 5))).toBe(true);
    });

    it('still answers gap queries under 20ms after adding another shape', () =>
    {
        const graphics = new Graphics();

        for (let i = 0; i < 4000; i++)
        {
            const column = i % 80;
            const row = Math.floor(i / 80);

            graphics.rect(column * 20, row * 20, 10, 10);
        }

        graphics.fill(0xffffff);
        graphics.rect(3000, 0, 10, 10).fill(0xffffff);

        graphics.containsPoint(new Point(0, 0));

        const start = performance.now();

        for (let i = 0; i < 200; i++)
        {
            const x = 15 + ((i % 50) * 20);

            expect(graphics.containsPoint(new Point(x, 15))).toBe(false);
        }

        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(20);
    });

    it('honours holes cut out of a fill', () =>
    {
        const graphics = new Graphics();

        graphics
            .rect(0, 0, 100, 100)
            .fill(0xffffff)
            .rect(40, 40, 20, 20)
            .cut();

        expect(graphics.containsPoint(new Point(50, 50))).toBe(false);
        expect(graphics.containsPoint(new Point(10, 10))).toBe(true);
        expect(graphics.containsPoint(new Point(39, 50))).toBe(true);
    });

    it('honours the pen transform when filling', () =>
    {
        const graphics = new Graphics();

        graphics
            .moveTo(100, 50)
            .rect(0, 0, 10, 10)
            .fill(0xffffff);

        expect(graphics.containsPoint(new Point(105, 55))).toBe(true);
        expect(graphics.containsPoint(new Point(5, 5))).toBe(false);
        expect(graphics.containsPoint(new Point(100, 50))).toBe(true);
    });

    it('hit tests circles correctly', () =>
    {
        const graphics = new Graphics();

        graphics.circle(2000, 2000, 8).fill(0xffffff);

        expect(graphics.containsPoint(new Point(2000, 2000))).toBe(true);
        expect(graphics.containsPoint(new Point(2000, 2009))).toBe(false);
        expect(graphics.containsPoint(new Point(2007, 2000))).toBe(true);
    });
});
