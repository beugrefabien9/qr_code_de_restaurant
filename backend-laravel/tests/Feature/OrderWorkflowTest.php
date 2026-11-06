<?php

namespace Tests\Feature;

use App\Models\Order;
use Database\Seeders\RestaurantSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\AuthenticatesPartnerApi;
use Tests\TestCase;

class OrderWorkflowTest extends TestCase
{
    use AuthenticatesPartnerApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RestaurantSeeder::class);
        $this->authenticatePartnerApi();
    }

    public function test_order_moves_from_kitchen_to_service_and_records_when_it_was_served(): void
    {
        $order = Order::firstOrFail();

        $this->postJson("/api/orders/{$order->id}/transition")
            ->assertOk()
            ->assertJsonPath('status', 'preparing')
            ->assertJsonPath('served_at', null);

        $this->postJson("/api/orders/{$order->id}/transition")
            ->assertOk()
            ->assertJsonPath('status', 'ready')
            ->assertJsonPath('served_at', null);

        $response = $this->postJson("/api/orders/{$order->id}/transition")
            ->assertOk()
            ->assertJsonPath('status', 'served');

        $this->assertNotNull($response->json('served_at'));
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'status' => 'served',
        ]);
        $servedAt = $order->fresh()->served_at;
        $this->assertNotNull($servedAt);

        $this->postJson("/api/orders/{$order->id}/transition")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('status');

        $this->assertSame($servedAt->toISOString(), $order->fresh()->served_at->toISOString());
    }

    public function test_legacy_confirmed_order_can_be_sent_to_the_kitchen(): void
    {
        $order = Order::firstOrFail();
        $order->update(['status' => 'confirmed']);

        $this->postJson("/api/orders/{$order->id}/transition")
            ->assertOk()
            ->assertJsonPath('status', 'preparing');
    }

    public function test_terminal_or_unknown_order_status_cannot_be_advanced(): void
    {
        $order = Order::firstOrFail();

        foreach (['served', 'paid', 'cancelled', 'refused', 'unexpected'] as $status) {
            $order->update(['status' => $status]);

            $this->postJson("/api/orders/{$order->id}/transition")
                ->assertUnprocessable()
                ->assertJsonValidationErrors('status');

            $this->assertSame($status, $order->fresh()->status);
        }
    }
}
