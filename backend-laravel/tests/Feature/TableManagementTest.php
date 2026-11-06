<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Restaurant;
use App\Models\Table;
use Database\Seeders\RestaurantSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Concerns\AuthenticatesPartnerApi;
use Tests\TestCase;

class TableManagementTest extends TestCase
{
    use AuthenticatesPartnerApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RestaurantSeeder::class);
        $this->authenticatePartnerApi();
    }

    public function test_table_can_be_created_with_a_qr_code_and_unique_number(): void
    {
        $restaurant = Restaurant::firstOrFail();

        $response = $this->postJson('/api/tables/', [
            'restaurant_id' => $restaurant->id,
            'number' => 3,
            'capacity' => 6,
        ])->assertCreated()
            ->assertJsonPath('number', 3)
            ->assertJsonPath('capacity', 6)
            ->assertJsonPath('status', 'free');

        $this->assertNotEmpty($response->json('qr_code'));

        $this->postJson('/api/tables/', [
            'restaurant_id' => $restaurant->id,
            'number' => 3,
            'capacity' => 2,
        ])->assertUnprocessable()
            ->assertJsonValidationErrors('number');
    }

    public function test_table_can_be_updated_without_changing_its_qr_code(): void
    {
        $table = Table::firstOrFail();
        $qrCode = $table->qr_token;

        $this->patchJson("/api/tables/{$table->id}/", [
            'number' => 3,
            'capacity' => 5,
            'status' => 'occupied',
        ])->assertOk()
            ->assertJsonPath('number', 3)
            ->assertJsonPath('capacity', 5)
            ->assertJsonPath('status', 'occupied')
            ->assertJsonPath('qr_code', $qrCode);
    }

    public function test_table_can_be_deleted_and_existing_orders_are_detached_from_it(): void
    {
        $table = Table::firstOrFail();
        $order = Order::where('table_id', $table->id)->firstOrFail();

        $this->deleteJson("/api/tables/{$table->id}/")->assertNoContent();

        $this->assertDatabaseMissing('tables', ['id' => $table->id]);
        $this->assertDatabaseHas('orders', [
            'id' => $order->id,
            'table_id' => null,
        ]);
    }
}
